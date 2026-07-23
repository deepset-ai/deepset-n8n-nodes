import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	apiRequest,
	apiRequestStream,
	consumeSseStream,
	extractPaginatedList,
	extractStreamErrorDetail,
	fetchPaginatedResults,
	parseJsonField,
	withServiceActivationRetry,
} from '../../utils';

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const sort = this.getNodeParameter('sort', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {};
	if (filters.groupLabel) {
		qs.group_label = filters.groupLabel;
	}
	if (filters.odataFilter) {
		qs.filter = filters.odataFilter;
	}
	if (sort.field) {
		qs.field = sort.field;
	}
	if (sort.order) {
		qs.order = sort.order;
	}

	const endpoint = `/workspaces/${workspaceName}/deployments`;
	const limit = returnAll ? 100 : (this.getNodeParameter('limit', itemIndex) as number);

	if (!returnAll && (filters.before || filters.after)) {
		// `before`/`after` are mutually exclusive with `page_number` (per
		// deployment_controller.py's list_deployments docstring: "Pagination
		// supports offset (page_number and limit) and keyset cursor (before /
		// after) modes; use one at a time") — bypass fetchPaginatedResults()
		// (which always sends page_number) and query directly instead.
		if (filters.before) qs.before = filters.before;
		if (filters.after) qs.after = filters.after;
		const response = await apiRequest.call(this, 'GET', endpoint, { qs: { ...qs, limit } });
		return extractPaginatedList(response);
	}

	return fetchPaginatedResults(this, endpoint, qs, returnAll, limit, extractPaginatedList);
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const deploymentId = this.getNodeParameter('deploymentId', itemIndex) as string;

	return (await apiRequest.call(
		this,
		'GET',
		`/workspaces/${workspaceName}/deployments/${deploymentId}`,
	)) as IDataObject;
}

function parseFileIds(value: unknown): string[] | undefined {
	if (typeof value !== 'string' || value.trim() === '') {
		return undefined;
	}
	return value
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
}

/**
 * The *-stream endpoints take a singular `query` string in the body, unlike
 * `search`/`chat`'s `queries: [query]` array — confirmed from deepset's API
 * docs example requests, which don't publish a full request-body schema
 * table for these endpoints yet. Worth re-checking against a live call if
 * the API ever starts rejecting this shape.
 */
async function runSearchStream(
	this: IExecuteFunctions,
	itemIndex: number,
	endpoint: 'search-stream' | 'chat-stream',
): Promise<IDataObject[]> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const deploymentId = this.getNodeParameter('deploymentId', itemIndex) as string;
	const query = this.getNodeParameter('query', itemIndex) as string;
	const simplify = this.getNodeParameter('simplify', itemIndex) as boolean;
	const additionalFields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;

	const body: IDataObject = { query };
	if (additionalFields.includeResult !== undefined) body.include_result = additionalFields.includeResult;
	if (additionalFields.includeToolCalls !== undefined) body.include_tool_calls = additionalFields.includeToolCalls;
	if (additionalFields.includeToolCallResults !== undefined)
		body.include_tool_call_results = additionalFields.includeToolCallResults;
	if (additionalFields.includeReasoning !== undefined) body.include_reasoning = additionalFields.includeReasoning;
	if (additionalFields.viewPrompts !== undefined) body.view_prompts = additionalFields.viewPrompts;
	const filters = parseJsonField.call(this, itemIndex, 'Filters (JSON)', additionalFields.filters);
	if (filters) body.filters = filters;
	const params = parseJsonField.call(this, itemIndex, 'Params (JSON)', additionalFields.params);
	if (params) body.params = params;
	const files = parseFileIds(additionalFields.files);
	if (files) body.files = files;

	let searchSessionId: string | undefined;
	if (endpoint === 'chat-stream') {
		searchSessionId = this.getNodeParameter('searchSessionId', itemIndex) as string;
		body.search_session_id = searchSessionId;
		if (additionalFields.chatHistoryLimit !== undefined) {
			body.chat_history_limit = additionalFields.chatHistoryLimit;
		}
	} else if (additionalFields.searchSessionId) {
		body.search_session_id = additionalFields.searchSessionId;
	}

	const waitForActivation = this.getNodeParameter('waitForActivation', itemIndex, false) as boolean;
	const maxWaitMinutes = this.getNodeParameter('maxWaitMinutes', itemIndex, 5) as number;

	// Relaying chunks live (via sendChunk) only has an observable effect when
	// this node is the tail of a chat-trigger workflow running in streaming
	// response mode — isStreaming() is how the node tells the two cases apart.
	// When this node runs as an AI Agent tool, n8n calls it through
	// ISupplyDataFunctions instead, which doesn't have isStreaming()/sendChunk
	// at all, so guard the call rather than assuming IExecuteFunctions.
	const relayLive = typeof this.isStreaming === 'function' && this.isStreaming();
	if (relayLive) this.sendChunk('begin', itemIndex);

	let stream: NodeJS.ReadableStream;
	try {
		stream = (await withServiceActivationRetry.call(
			this,
			() =>
				apiRequestStream.call(
					this,
					'POST',
					`/workspaces/${workspaceName}/deployments/${deploymentId}/${endpoint}`,
					body,
				),
			waitForActivation,
			maxWaitMinutes * 60_000,
		)) as NodeJS.ReadableStream;
	} catch (error) {
		if (relayLive) this.sendChunk('error', itemIndex, error instanceof Error ? error.message : 'Request failed');
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- already a NodeApiError (apiRequestStream/withServiceActivationRetry always throw one); rethrowing in place preserves .context.data (see apiRequest()'s docstring in utils.ts)
		throw error;
	}

	const events: IDataObject[] = [];
	let textContent = '';
	let finalResult: IDataObject | undefined;
	let streamError: { message: string; data: IDataObject[string] } | undefined;

	await consumeSseStream(stream, (event) => {
		events.push(event);
		if (relayLive) this.sendChunk('item', itemIndex, event);

		if (event.type === 'delta') {
			const delta = event.delta as IDataObject | undefined;
			if (typeof delta?.text === 'string') textContent += delta.text;
		} else if (event.type === 'result') {
			finalResult = event.result as IDataObject | undefined;
		} else if (event.type === 'error') {
			streamError = extractStreamErrorDetail(event.error ?? event);
		}
	});

	if (streamError) {
		if (relayLive) this.sendChunk('error', itemIndex, streamError.message);
		const error = new NodeOperationError(
			this.getNode(),
			`The stream returned an error: ${streamError.message}`,
			{ itemIndex },
		);
		error.context.data = streamError.data;
		throw error;
	}

	if (relayLive) this.sendChunk('end', itemIndex);

	if (!simplify) {
		return events;
	}

	const aggregated: IDataObject = { content: textContent };
	if (finalResult) aggregated.result = finalResult;
	if (endpoint === 'chat-stream' && searchSessionId) aggregated.search_session_id = searchSessionId;
	return [aggregated];
}

export async function executeService(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	let result: IDataObject | IDataObject[];
	switch (operation) {
		case 'get':
			result = await get.call(this, itemIndex);
			break;
		case 'getAll':
			result = await getAll.call(this, itemIndex);
			break;
		case 'searchStream':
			result = await runSearchStream.call(this, itemIndex, 'search-stream');
			break;
		case 'chatStream':
			result = await runSearchStream.call(this, itemIndex, 'chat-stream');
			break;
		default:
			throw new Error(`Unknown Service operation: ${operation}`);
	}

	const items = Array.isArray(result) ? result : [result];
	return items.map((json) => ({ json }));
}
