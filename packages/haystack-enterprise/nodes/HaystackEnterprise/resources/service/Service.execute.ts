import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	apiRequest,
	apiRequestStream,
	consumeSseStream,
	extractPaginatedList,
	extractStreamErrorDetail,
	fetchListWithCursorOrPaging,
	getResponseHeader,
	parseCommaSeparatedList,
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

	const limit = returnAll ? 100 : (this.getNodeParameter('limit', itemIndex) as number);

	// `before`/`after` are mutually exclusive with `page_number` (per
	// deployment_controller.py's list_deployments docstring: "Pagination
	// supports offset (page_number and limit) and keyset cursor (before /
	// after) modes; use one at a time") — see fetchListWithCursorOrPaging()'s
	// own docstring for how that's handled.
	return fetchListWithCursorOrPaging(
		this,
		`/workspaces/${workspaceName}/deployments`,
		qs,
		returnAll,
		limit,
		filters,
		extractPaginatedList,
	);
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
	const files = parseCommaSeparatedList(additionalFields.files);
	if (files.length > 0) body.files = files;

	// search-stream is a one-off, historyless request — it has no concept of a
	// search session. Only chat-stream takes one, and only optionally: when
	// omitted, Haystack Enterprise creates one on the fly and reports its ID
	// back via the X-Search-Session-Id response header (read below, once the
	// stream request has been made).
	let searchSessionId: string | undefined;
	if (endpoint === 'chat-stream') {
		searchSessionId = this.getNodeParameter('searchSessionId', itemIndex, '') as string;
		if (searchSessionId) body.search_session_id = searchSessionId;
		if (additionalFields.chatHistoryLimit !== undefined) {
			body.chat_history_limit = additionalFields.chatHistoryLimit;
		}
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
		// withServiceActivationRetry is generic; calling it via .call() erases its
		// type parameter to `unknown` (same rationale as withApiErrorWrapping()'s
		// own docstring in utils.ts), hence the cast.
		const response = (await withServiceActivationRetry.call(
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
		)) as { stream: NodeJS.ReadableStream; headers: IDataObject };
		stream = response.stream;
		// Only relevant for chat-stream when searchSessionId wasn't supplied —
		// echoes back the ID of the session Haystack Enterprise just created.
		if (endpoint === 'chat-stream') {
			searchSessionId ||= getResponseHeader(response.headers, 'X-Search-Session-Id');
		}
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

		if (event.type === 'delta') {
			const delta = event.delta as IDataObject | undefined;
			const text = typeof delta?.text === 'string' ? delta.text : undefined;
			if (text) {
				textContent += text;
				// sendChunk() JSON.stringifies any non-string content as-is before
				// relaying it to the chat UI, so passing the raw event here (like
				// every other event type below) would dump its full JSON into the
				// chat instead of the plain answer text — only the text piece itself
				// is meant to be shown live.
				if (relayLive) this.sendChunk('item', itemIndex, text);
			}
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
		// Not part of the SSE payload itself (it only ever arrives via the
		// response header), so stamp it onto every event or raw-mode callers
		// relying on a freshly auto-created session would have no way to see it.
		if (searchSessionId) events.forEach((event) => (event.search_session_id = searchSessionId));
		return events;
	}

	const aggregated: IDataObject = { content: textContent };
	if (finalResult) aggregated.result = finalResult;
	if (searchSessionId) aggregated.search_session_id = searchSessionId;
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
			throw new NodeOperationError(this.getNode(), `Unknown Service operation: ${operation}`, { itemIndex });
	}

	const items = Array.isArray(result) ? result : [result];
	return items.map((json) => ({ json }));
}
