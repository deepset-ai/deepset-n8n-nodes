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
 * GET /workspaces/{workspace}/deployments/v1/models/ — OpenAI-compatible model
 * list. No pagination; each deployment in the workspace is one model entry.
 */
async function listModels(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;

	const response = (await apiRequest.call(
		this,
		'GET',
		`/workspaces/${workspaceName}/deployments/v1/models/`,
	)) as IDataObject;

	const data = response.data;
	if (!Array.isArray(data)) {
		throw new NodeOperationError(
			this.getNode(),
			'The models response did not contain a data array',
			{ itemIndex },
		);
	}

	return data as IDataObject[];
}

/**
 * The *-stream endpoints take a singular `query` string in the body, unlike
 * `search`/`chat`'s `queries: [query]` array.
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
	if (additionalFields.includeResult !== undefined)
		body.include_result = additionalFields.includeResult;
	if (additionalFields.includeToolCalls !== undefined)
		body.include_tool_calls = additionalFields.includeToolCalls;
	if (additionalFields.includeToolCallResults !== undefined)
		body.include_tool_call_results = additionalFields.includeToolCallResults;
	if (additionalFields.includeReasoning !== undefined)
		body.include_reasoning = additionalFields.includeReasoning;
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
	// back via the X-Search-Session-Id response header
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
		if (relayLive)
			this.sendChunk('error', itemIndex, error instanceof Error ? error.message : 'Request failed');
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

/**
 * `type: 'json'` parameters arrive as a string or already-parsed value depending
 * on whether the user typed JSON or used an expression. Unlike `parseJsonField()`
 * in utils (typed for objects), this accepts arrays and objects and passes through
 * already-parsed values.
 */
function parseJsonValue(
	this: IExecuteFunctions,
	itemIndex: number,
	fieldName: string,
	value: unknown,
): unknown {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (typeof value !== 'string') {
		return value;
	}
	if (value.trim() === '') {
		return undefined;
	}
	try {
		return JSON.parse(value);
	} catch {
		throw new NodeOperationError(this.getNode(), `"${fieldName}" is not valid JSON`, { itemIndex });
	}
}

function readMessages(this: IExecuteFunctions, itemIndex: number): IDataObject[] {
	const messagesInput = this.getNodeParameter('messagesInput', itemIndex, 'fields') as string;
	if (messagesInput === 'json') {
		const parsed = parseJsonValue.call(
			this,
			itemIndex,
			'Messages',
			this.getNodeParameter('messagesJson', itemIndex),
		);
		if (!Array.isArray(parsed) || parsed.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Messages must be a non-empty JSON array', {
				itemIndex,
			});
		}
		return parsed as IDataObject[];
	}

	const collection = this.getNodeParameter('messages', itemIndex, {}) as IDataObject;
	const rows = (collection.message as IDataObject[]) ?? [];
	if (rows.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Messages cannot be empty', { itemIndex });
	}

	return rows.map((row, index) => {
		const role = row.role as string;
		const content = row.content;
		const message: IDataObject = { role };
		if (content !== undefined && content !== '') {
			message.content = content;
		}
		if (role === 'tool') {
			const toolCallId = typeof row.toolCallId === 'string' ? row.toolCallId.trim() : '';
			if (!toolCallId) {
				throw new NodeOperationError(
					this.getNode(),
					`Message ${index + 1}: "Tool Call ID" is required on tool messages`,
					{ itemIndex },
				);
			}
			message.tool_call_id = toolCallId;
		}
		if (message.content === undefined) {
			throw new NodeOperationError(
				this.getNode(),
				`Message ${index + 1}: content is required. For tool-call-only assistant messages, use JSON input.`,
				{ itemIndex },
			);
		}
		return message;
	});
}

function applyChatCompletionExtras(
	this: IExecuteFunctions,
	itemIndex: number,
	body: IDataObject,
	additionalFields: IDataObject,
): void {
	if (additionalFields.maxCompletionTokens !== undefined) {
		body.max_completion_tokens = additionalFields.maxCompletionTokens;
	}
	if (additionalFields.topP !== undefined) body.top_p = additionalFields.topP;

	const extra = parseJsonValue.call(
		this,
		itemIndex,
		'Extra Parameters (JSON)',
		additionalFields.extraParameters,
	);
	if (extra !== undefined) {
		if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
			throw new NodeOperationError(
				this.getNode(),
				'"Extra Parameters (JSON)" must be a JSON object',
				{
					itemIndex,
				},
			);
		}
		const extras = { ...(extra as IDataObject) };
		delete extras.messages;
		delete extras.model;
		delete extras.stream;
		Object.assign(body, extras);
	}
}

function assertSingleChoiceWhenSimplifying(
	this: IExecuteFunctions,
	itemIndex: number,
	body: IDataObject,
	simplify: boolean,
): void {
	if (!simplify) {
		return;
	}
	const n = body.n;
	const choiceCount = typeof n === 'number' && Number.isFinite(n) ? n : 1;
	if (choiceCount !== 1) {
		throw new NodeOperationError(
			this.getNode(),
			'Simplify Output only supports a single completion choice (n=1). Turn off Simplify Output or set n to 1 in Extra Parameters.',
			{ itemIndex },
		);
	}
}

function deltaContent(chunk: IDataObject): string | undefined {
	const choices = chunk.choices;
	if (
		!Array.isArray(choices) ||
		choices.length === 0 ||
		typeof choices[0] !== 'object' ||
		!choices[0]
	) {
		return undefined;
	}
	const delta = (choices[0] as IDataObject).delta as IDataObject | undefined;
	return typeof delta?.content === 'string' ? delta.content : undefined;
}

function aggregateChatCompletionChunks(chunks: IDataObject[]): IDataObject {
	const contentParts: string[] = [];
	const toolCallsByIndex = new Map<number, IDataObject>();
	let finishReason = 'stop';
	let id: IDataObject['id'];
	let model: IDataObject['model'];
	let created: IDataObject['created'];

	for (const chunk of chunks) {
		if (chunk.id !== undefined) id = chunk.id;
		if (chunk.model !== undefined) model = chunk.model;
		if (chunk.created !== undefined) created = chunk.created;

		const choices = chunk.choices;
		if (!Array.isArray(choices) || typeof choices[0] !== 'object' || !choices[0]) {
			continue;
		}
		const choice = choices[0] as IDataObject;
		if (typeof choice.finish_reason === 'string') {
			finishReason = choice.finish_reason;
		}
		const delta = choice.delta as IDataObject | undefined;
		if (!delta) continue;
		if (typeof delta.content === 'string') contentParts.push(delta.content);

		const toolCalls = delta.tool_calls;
		if (!Array.isArray(toolCalls)) continue;
		for (const toolCall of toolCalls) {
			if (typeof toolCall !== 'object' || !toolCall) continue;
			const entry = toolCall as IDataObject;
			const index = typeof entry.index === 'number' ? entry.index : 0;
			const current = toolCallsByIndex.get(index) ?? {
				type: 'function',
				function: { name: '', arguments: '' },
			};
			if (typeof entry.id === 'string') current.id = entry.id;
			if (typeof entry.type === 'string') current.type = entry.type;
			const fn = entry.function as IDataObject | undefined;
			const currentFn = current.function as IDataObject;
			if (typeof fn?.name === 'string') currentFn.name = fn.name;
			if (typeof fn?.arguments === 'string') {
				currentFn.arguments = `${currentFn.arguments as string}${fn.arguments}`;
			}
			toolCallsByIndex.set(index, current);
		}
	}

	const message: IDataObject = {
		role: 'assistant',
		content: contentParts.length > 0 ? contentParts.join('') : null,
	};
	if (toolCallsByIndex.size > 0) {
		message.tool_calls = [...toolCallsByIndex.entries()]
			.sort(([left], [right]) => left - right)
			.map(([, toolCall]) => toolCall);
	}

	return {
		id,
		object: 'chat.completion',
		created,
		model,
		choices: [{ index: 0, message, finish_reason: finishReason }],
	};
}

function simplifyChatCompletion(completion: IDataObject): IDataObject {
	const choices = completion.choices;
	const choice =
		Array.isArray(choices) && typeof choices[0] === 'object' && choices[0]
			? (choices[0] as IDataObject)
			: {};
	const message = (choice.message as IDataObject) ?? {};
	const simplified: IDataObject = {
		content: message.content ?? '',
		role: message.role ?? 'assistant',
		finish_reason: choice.finish_reason ?? 'stop',
	};
	if (message.tool_calls) simplified.tool_calls = message.tool_calls;
	if (completion.id !== undefined) simplified.id = completion.id;
	if (completion.model !== undefined) simplified.model = completion.model;
	return simplified;
}

/**
 * POST /workspaces/{workspace}/deployments/v1/chat/completions — the deployment
 * is selected by `model: "{workspace}/{deployment_id}"` in the body, not a path
 * segment. `stream: false` (default) returns one OpenAI `chat.completion` JSON
 * object; `stream: true` returns OpenAI `chat.completion.chunk` SSE (not the
 * Haystack-native delta/result events that chat-stream uses).
 */
async function runChatCompletions(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const deploymentId = this.getNodeParameter('deploymentId', itemIndex) as string;
	const stream = this.getNodeParameter('stream', itemIndex, false) as boolean;
	const simplify = this.getNodeParameter('simplify', itemIndex, true) as boolean;
	const additionalFields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;

	const body: IDataObject = {
		model: `${workspaceName}/${deploymentId}`,
		messages: readMessages.call(this, itemIndex),
		stream,
	};
	applyChatCompletionExtras.call(this, itemIndex, body, additionalFields);
	assertSingleChoiceWhenSimplifying.call(this, itemIndex, body, simplify);

	const waitForActivation = this.getNodeParameter('waitForActivation', itemIndex, false) as boolean;
	const maxWaitMinutes = this.getNodeParameter('maxWaitMinutes', itemIndex, 5) as number;
	const endpoint = `/workspaces/${workspaceName}/deployments/v1/chat/completions`;
	const relayLive = typeof this.isStreaming === 'function' && this.isStreaming();

	if (!stream) {
		const completion = (await withServiceActivationRetry.call(
			this,
			() => apiRequest.call(this, 'POST', endpoint, { body }),
			waitForActivation,
			maxWaitMinutes * 60_000,
		)) as IDataObject;
		if (relayLive) {
			this.sendChunk('begin', itemIndex);
			const content = simplifyChatCompletion(completion).content;
			if (typeof content === 'string' && content) this.sendChunk('item', itemIndex, content);
			this.sendChunk('end', itemIndex);
		}
		return [simplify ? simplifyChatCompletion(completion) : completion];
	}

	if (relayLive) this.sendChunk('begin', itemIndex);

	let responseStream: NodeJS.ReadableStream;
	try {
		const response = (await withServiceActivationRetry.call(
			this,
			() => apiRequestStream.call(this, 'POST', endpoint, body),
			waitForActivation,
			maxWaitMinutes * 60_000,
		)) as { stream: NodeJS.ReadableStream; headers: IDataObject };
		responseStream = response.stream;
	} catch (error) {
		if (relayLive)
			this.sendChunk('error', itemIndex, error instanceof Error ? error.message : 'Request failed');
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- already a NodeApiError (apiRequestStream/withServiceActivationRetry always throw one); rethrowing in place preserves .context.data (see apiRequest()'s docstring in utils.ts)
		throw error;
	}

	const chunks: IDataObject[] = [];
	let streamError: { message: string; data: IDataObject[string] } | undefined;

	await consumeSseStream(responseStream, (event) => {
		if (event.error !== undefined) {
			streamError = extractStreamErrorDetail(event.error ?? event);
			return;
		}
		chunks.push(event);
		const text = deltaContent(event);
		if (text && relayLive) this.sendChunk('item', itemIndex, text);
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
		return chunks;
	}
	return [simplifyChatCompletion(aggregateChatCompletionChunks(chunks))];
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
		case 'chatCompletions':
			result = await runChatCompletions.call(this, itemIndex);
			break;
		case 'listModels':
			result = await listModels.call(this, itemIndex);
			break;
		default:
			throw new NodeOperationError(this.getNode(), `Unknown Service operation: ${operation}`, {
				itemIndex,
			});
	}

	const items = Array.isArray(result) ? result : [result];
	return items.map((json) => ({ json }));
}
