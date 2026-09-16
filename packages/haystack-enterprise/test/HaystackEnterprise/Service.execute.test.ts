import { describe, expect, it, vi } from 'vitest';
import { executeService } from '../../nodes/HaystackEnterprise/resources/service/Service.execute';
import { createExecuteContext as createContext, FakeStream } from './testHelpers';

/** Lets queued promise continuations run before the test drives the fake stream further. */
function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function sseRecord(event: Record<string, unknown>): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

interface StreamContextOptions {
	params: Record<string, unknown>;
	streamRequestError?: Error;
	isStreaming?: boolean;
	responseHeaders?: Record<string, string>;
}

function createStreamContext({ params, streamRequestError, isStreaming, responseHeaders }: StreamContextOptions) {
	const stream = new FakeStream();
	const sendChunk = vi.fn();

	const { context, httpRequestWithAuthentication } = createContext(
		params,
		async () => {
			// The *-stream endpoint: resolves immediately with the full response
			// (returnFullResponse: true), same as the real encoding: 'stream'
			// behavior — the body arrives later via 'data'/'end' events, not by
			// awaiting this call any further.
			if (streamRequestError) throw streamRequestError;
			return { body: stream, headers: responseHeaders ?? {} };
		},
		{},
		{ isStreaming: () => isStreaming ?? false, sendChunk },
	);

	return { context, stream, sendChunk, httpRequestWithAuthentication };
}

describe('executeService — get many', () => {
	it('returns each service as its own item', async () => {
		const { context } = createContext(
			{ workspaceName: 'ws', returnAll: false, limit: 50, filters: {}, sort: {} },
			async () => ({ data: [{ deployment_id: 'a' }, { deployment_id: 'b' }], has_more: false, total: 2 }),
		);

		const result = await executeService.call(context, 'getAll', 0);

		expect(result).toEqual([{ json: { deployment_id: 'a' } }, { json: { deployment_id: 'b' } }]);
	});

	it('passes the group label, OData filter, and sort options as query params', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				returnAll: false,
				limit: 50,
				filters: { groupLabel: 'PRODUCTION', odataFilter: "status eq 'DEPLOYED'" },
				sort: { field: 'pipeline_name', order: 'ASC' },
			},
			async () => ({ data: [], has_more: false, total: 0 }),
		);

		await executeService.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				qs: expect.objectContaining({
					group_label: 'PRODUCTION',
					filter: "status eq 'DEPLOYED'",
					field: 'pipeline_name',
					order: 'ASC',
				}),
			}),
		);
	});

	it('queries by the before cursor instead of page_number when Return All is off', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', returnAll: false, limit: 50, filters: { before: 'service-cursor-1' }, sort: {} },
			async () => ({ data: [{ deployment_id: 'a' }], has_more: false, total: 1 }),
		);

		const result = await executeService.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [string, { qs: Record<string, unknown> }];
		expect(options.qs).toMatchObject({ before: 'service-cursor-1' });
		expect(options.qs).not.toHaveProperty('page_number');
		expect(result).toEqual([{ json: { deployment_id: 'a' } }]);
	});

	it('queries by the after cursor instead of page_number when Return All is off', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', returnAll: false, limit: 50, filters: { after: 'service-cursor-2' }, sort: {} },
			async () => ({ data: [{ deployment_id: 'b' }], has_more: false, total: 1 }),
		);

		await executeService.call(context, 'getAll', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [string, { qs: Record<string, unknown> }];
		expect(options.qs).toMatchObject({ after: 'service-cursor-2' });
		expect(options.qs).not.toHaveProperty('page_number');
	});

	it('ignores before/after and uses page_number pagination when Return All is on', async () => {
		let call = 0;
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', returnAll: true, filters: { before: 'service-cursor-1' }, sort: {} },
			async () => {
				call += 1;
				if (call === 1) {
					return { data: [{ deployment_id: 'a' }], has_more: true, total: 2 };
				}
				return { data: [{ deployment_id: 'b' }], has_more: false, total: 2 };
			},
		);

		await executeService.call(context, 'getAll', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [string, { qs: Record<string, unknown> }];
		expect(options.qs).toHaveProperty('page_number');
		expect(options.qs).not.toHaveProperty('before');
	});
});

describe('executeService — stream request error handling', () => {
	it('preserves the underlying API error detail when re-wrapping a failed request', async () => {
		// Regression test: a real HTTP failure caught by apiRequestStream() gets
		// wrapped in a NodeApiError whose `.description` holds the API's actual
		// error body (e.g. `response.data.message`), while `.message` is often
		// just n8n's generic per-status-code fallback text.
		const apiError = Object.assign(new Error('Request failed with status code 500'), {
			response: { status: 500, data: { message: 'Pipeline execution failed: missing component X' } },
		});
		const { context } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				searchSessionId: 'session-1',
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			streamRequestError: apiError,
		});

		await expect(executeService.call(context, 'chatStream', 0)).rejects.toMatchObject({
			description: expect.stringContaining('Pipeline execution failed: missing component X'),
		});
	});

	it('preserves `context.data` (the raw API error body) so n8n\'s UI can render its "Error data" section', async () => {
		// n8n's node-error-view component only shows the "Error data" section
		// when `error.context.data` is populated.
		const apiError = Object.assign(new Error('Request failed with status code 500'), {
			response: { status: 500, data: { errors: ['Pipeline execution failed: missing component X'] } },
		});
		const { context } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				searchSessionId: 'session-1',
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			streamRequestError: apiError,
		});

		await expect(executeService.call(context, 'chatStream', 0)).rejects.toMatchObject({
			context: { data: { errors: ['Pipeline execution failed: missing component X'] } },
		});
	});

	it('surfaces only the first `errors` entry as the description, unlike non-streaming operations which join them all', async () => {
		// Full Message should read as one sentence, not several joined by "; " —
		// the full list is still available via `context.data` for "Error data".
		const apiError = Object.assign(new Error('Request failed with status code 500'), {
			response: { status: 500, data: { errors: ['missing component X', 'invalid config Y'] } },
		});
		const { context } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				searchSessionId: 'session-1',
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			streamRequestError: apiError,
		});

		await expect(executeService.call(context, 'chatStream', 0)).rejects.toMatchObject({
			description: 'missing component X',
			context: { data: { errors: ['missing component X', 'invalid config Y'] } },
		});
	});
});

describe('executeService — streaming (searchStream / chatStream)', () => {
	it('aggregates deltas and the final result into one item when Simplify Output is on', async () => {
		const { context, stream } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
		});

		const resultPromise = executeService.call(context, 'searchStream', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord({ type: 'delta', delta: { text: 'Hel' } }));
		stream.emit('data', sseRecord({ type: 'delta', delta: { text: 'lo' } }));
		stream.emit('data', sseRecord({ type: 'result', result: { results: [{ answers: [{ answer: 'Hello' }] }] } }));
		stream.emit('end');

		expect(await resultPromise).toEqual([
			{ json: { content: 'Hello', result: { results: [{ answers: [{ answer: 'Hello' }] }] } } },
		]);
	});

	it('returns one item per event when Simplify Output is off', async () => {
		const { context, stream } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: false,
				additionalFields: {},
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
		});

		const resultPromise = executeService.call(context, 'searchStream', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord({ type: 'delta', delta: { text: 'Hi' } }));
		stream.emit('end');

		expect(await resultPromise).toEqual([{ json: { type: 'delta', delta: { text: 'Hi' } } }]);
	});

	it('sends live chunks via sendChunk when the node is streaming to a chat trigger', async () => {
		const { context, stream, sendChunk } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			isStreaming: true,
		});

		const resultPromise = executeService.call(context, 'searchStream', 0);
		await flushMicrotasks();
		const event = { type: 'delta', delta: { text: 'Hi' } };
		stream.emit('data', sseRecord(event));
		stream.emit('end');
		await resultPromise;

		// Only the plain delta text is relayed live, not the raw event object —
		// sendChunk() JSON.stringifies non-string content before showing it in
		// the chat UI, so forwarding the raw event would leak its full JSON.
		expect(sendChunk).toHaveBeenNthCalledWith(1, 'begin', 0);
		expect(sendChunk).toHaveBeenNthCalledWith(2, 'item', 0, 'Hi');
		expect(sendChunk).toHaveBeenNthCalledWith(3, 'end', 0);
	});

	it('does not call sendChunk when the node is not streaming to a caller', async () => {
		const { context, stream, sendChunk } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			isStreaming: false,
		});

		const resultPromise = executeService.call(context, 'searchStream', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord({ type: 'delta', delta: { text: 'Hi' } }));
		stream.emit('end');
		await resultPromise;

		expect(sendChunk).not.toHaveBeenCalled();
	});

	it('does not throw when run as an AI Agent tool, where isStreaming/sendChunk do not exist on the context', async () => {
		// Regression test: n8n executes usableAsTool nodes through
		// ISupplyDataFunctions, which has no isStreaming()/sendChunk at all —
		// unlike the isStreaming: false case above, those properties are
		// missing here, not just falsy.
		const { context, stream } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
		});
		delete (context as { isStreaming?: unknown }).isStreaming;
		delete (context as { sendChunk?: unknown }).sendChunk;

		const resultPromise = executeService.call(context, 'searchStream', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord({ type: 'delta', delta: { text: 'Hi' } }));
		stream.emit('end');

		await expect(resultPromise).resolves.toEqual([{ json: { content: 'Hi' } }]);
	});

	it('throws when the stream reports an error event, and still emits a sendChunk error', async () => {
		const { context, stream, sendChunk } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			isStreaming: true,
		});

		const resultPromise = executeService.call(context, 'searchStream', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord({ type: 'error', error: 'Pipeline execution failed' }));
		stream.emit('end');

		await expect(resultPromise).rejects.toThrow(/Pipeline execution failed/);
		expect(sendChunk).toHaveBeenCalledWith('error', 0, 'Pipeline execution failed');
	});

	it('surfaces the first `errors` entry when a stream error event carries deepset\'s `{ errors: [...] }` shape', async () => {
		const { context, stream, sendChunk } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			isStreaming: true,
		});

		const resultPromise = executeService.call(context, 'searchStream', 0);
		await flushMicrotasks();
		stream.emit(
			'data',
			sseRecord({ type: 'error', error: { errors: ['missing component X', 'invalid config Y'] } }),
		);
		stream.emit('end');

		await expect(resultPromise).rejects.toThrow(/missing component X/);
		expect(sendChunk).toHaveBeenCalledWith('error', 0, 'missing component X');
		await expect(resultPromise).rejects.toMatchObject({
			context: { data: { errors: ['missing component X', 'invalid config Y'] } },
		});
	});

	it('falls back to a generic message when a stream error event has no recognizable `errors` array', async () => {
		const { context, stream, sendChunk } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			isStreaming: true,
		});

		const resultPromise = executeService.call(context, 'searchStream', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord({ type: 'error' }));
		stream.emit('end');

		await expect(resultPromise).rejects.toThrow(/The stream returned an unknown error/);
		expect(sendChunk).toHaveBeenCalledWith('error', 0, 'The stream returned an unknown error');
	});

	it('includes the search session ID for chatStream in the request body and the aggregated output', async () => {
		const { context, stream, httpRequestWithAuthentication } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				searchSessionId: 'existing-session',
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
		});

		const resultPromise = executeService.call(context, 'chatStream', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord({ type: 'delta', delta: { text: 'Hi' } }));
		stream.emit('end');

		const result = await resultPromise;

		const calls = httpRequestWithAuthentication.mock.calls as unknown as Array<[string, { url: string }]>;
		const createCalls = calls.filter(([, options]) => options.url.endsWith('/search_sessions'));
		expect(createCalls).toHaveLength(0);

		const streamCall = calls.find(([, options]) => options.url.endsWith('/chat-stream'));
		expect(streamCall?.[1]).toMatchObject({ body: { query: 'hello', search_session_id: 'existing-session' } });
		expect(result).toEqual([{ json: { content: 'Hi', search_session_id: 'existing-session' } }]);
	});

	it('omits search_session_id from the request body when none is supplied, and reads the auto-created one back from the response header', async () => {
		const { context, stream, httpRequestWithAuthentication } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: true,
				additionalFields: {},
				searchSessionId: '',
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			responseHeaders: { 'X-Search-Session-Id': 'auto-created-session' },
		});

		const resultPromise = executeService.call(context, 'chatStream', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord({ type: 'delta', delta: { text: 'Hi' } }));
		stream.emit('end');

		const result = await resultPromise;

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }];
		expect(options.body).not.toHaveProperty('search_session_id');
		expect(result).toEqual([{ json: { content: 'Hi', search_session_id: 'auto-created-session' } }]);
	});

	it('stamps the auto-created search session ID onto every raw event when Simplify Output is off', async () => {
		const { context, stream } = createStreamContext({
			params: {
				workspaceName: 'ws',
				deploymentId: 'dep-1',
				query: 'hello',
				simplify: false,
				additionalFields: {},
				searchSessionId: '',
				waitForActivation: false,
				maxWaitMinutes: 5,
			},
			responseHeaders: { 'X-Search-Session-Id': 'auto-created-session' },
		});

		const resultPromise = executeService.call(context, 'chatStream', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord({ type: 'delta', delta: { text: 'Hi' } }));
		stream.emit('end');

		expect(await resultPromise).toEqual([
			{ json: { type: 'delta', delta: { text: 'Hi' }, search_session_id: 'auto-created-session' } },
		]);
	});
});

const CHAT_COMPLETIONS_PARAMS = {
	workspaceName: 'ws',
	deploymentId: 'dep-1',
	messagesInput: 'fields',
	messages: { message: [{ role: 'user', content: 'hello' }] },
	stream: false,
	simplify: true,
	additionalFields: {},
	waitForActivation: false,
	maxWaitMinutes: 5,
};

const CHAT_COMPLETION_RESPONSE = {
	id: 'chatcmpl-1',
	object: 'chat.completion',
	created: 1730000000,
	model: 'ws/dep-1',
	choices: [
		{
			index: 0,
			message: { role: 'assistant', content: 'Hello' },
			finish_reason: 'stop',
		},
	],
};

function openaiChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
	return {
		id: 'chatcmpl-1',
		object: 'chat.completion.chunk',
		created: 1730000000,
		model: 'ws/dep-1',
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	};
}

describe('executeService — chatCompletions', () => {
	it('posts to the deployment-scoped endpoint with model workspace/deployment_id', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			CHAT_COMPLETIONS_PARAMS,
			async () => CHAT_COMPLETION_RESPONSE,
		);

		const result = await executeService.call(context, 'chatCompletions', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				method: 'POST',
				url: expect.stringMatching(/\/workspaces\/ws\/deployments\/v1\/chat\/completions$/),
				body: {
					model: 'ws/dep-1',
					messages: [{ role: 'user', content: 'hello' }],
					stream: false,
				},
			}),
		);
		expect(result).toEqual([
			{
				json: {
					content: 'Hello',
					role: 'assistant',
					finish_reason: 'stop',
					id: 'chatcmpl-1',
					model: 'ws/dep-1',
				},
			},
		]);
	});

	it('returns the raw chat completion object when Simplify Output is off', async () => {
		const { context } = createContext(
			{ ...CHAT_COMPLETIONS_PARAMS, simplify: false },
			async () => CHAT_COMPLETION_RESPONSE,
		);

		expect(await executeService.call(context, 'chatCompletions', 0)).toEqual([
			{ json: CHAT_COMPLETION_RESPONSE },
		]);
	});

	it('accepts a messages JSON array, including an already-parsed value', async () => {
		const messages = [
			{ role: 'system', content: 'be nice' },
			{ role: 'user', content: 'hi' },
		];
		const { context, httpRequestWithAuthentication } = createContext(
			{ ...CHAT_COMPLETIONS_PARAMS, messagesInput: 'json', messagesJson: messages },
			async () => CHAT_COMPLETION_RESPONSE,
		);

		await executeService.call(context, 'chatCompletions', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [
			string,
			{ body: { messages: unknown } },
		];
		expect(options.body.messages).toEqual(messages);
	});

	it('throws when messages are empty', async () => {
		const { context } = createContext(
			{ ...CHAT_COMPLETIONS_PARAMS, messages: { message: [] } },
			async () => CHAT_COMPLETION_RESPONSE,
		);

		await expect(executeService.call(context, 'chatCompletions', 0)).rejects.toThrow(/Messages cannot be empty/);
	});

	it('includes tool_call_id on tool messages and forwards generation extras', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				...CHAT_COMPLETIONS_PARAMS,
				messages: {
					message: [
						{ role: 'user', content: "What's the weather?" },
						{ role: 'tool', content: '18°C', toolCallId: 'call_1' },
					],
				},
				additionalFields: {
					temperature: 0.2,
					maxCompletionTokens: 256,
					topP: 0.9,
					extraParameters: '{"presence_penalty": 0.1}',
				},
			},
			async () => CHAT_COMPLETION_RESPONSE,
		);

		await executeService.call(context, 'chatCompletions', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [
			string,
			{ body: Record<string, unknown> },
		];
		expect(options.body).toMatchObject({
			messages: [
				{ role: 'user', content: "What's the weather?" },
				{ role: 'tool', content: '18°C', tool_call_id: 'call_1' },
			],
			temperature: 0.2,
			max_completion_tokens: 256,
			top_p: 0.9,
			presence_penalty: 0.1,
		});
		expect(options.body).not.toHaveProperty('tools');
		expect(options.body).not.toHaveProperty('tool_choice');
	});

	it('does not let extra parameters overwrite model, messages, or stream', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				...CHAT_COMPLETIONS_PARAMS,
				additionalFields: {
					extraParameters: '{"model": "other/id", "messages": [], "stream": true, "temperature": 0.5}',
				},
			},
			async () => CHAT_COMPLETION_RESPONSE,
		);

		await executeService.call(context, 'chatCompletions', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [
			string,
			{ body: Record<string, unknown> },
		];
		expect(options.body.model).toBe('ws/dep-1');
		expect(options.body.messages).toEqual([{ role: 'user', content: 'hello' }]);
		expect(options.body.stream).toBe(false);
		expect(options.body.temperature).toBe(0.5);
	});

	it('aggregates streamed content and tool-call deltas when Simplify Output is on', async () => {
		const { context, stream } = createStreamContext({
			params: { ...CHAT_COMPLETIONS_PARAMS, stream: true },
		});

		const resultPromise = executeService.call(context, 'chatCompletions', 0);
		await flushMicrotasks();
		stream.emit(
			'data',
			sseRecord(
				openaiChunk({
					tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } }],
				}),
			),
		);
		stream.emit(
			'data',
			sseRecord(openaiChunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] })),
		);
		stream.emit(
			'data',
			sseRecord(openaiChunk({ tool_calls: [{ index: 0, function: { arguments: '"Berlin"}' } }] })),
		);
		stream.emit('data', sseRecord(openaiChunk({ role: 'assistant' }, 'tool_calls')));
		stream.emit('end');

		expect(await resultPromise).toEqual([
			{
				json: {
					content: '',
					role: 'assistant',
					finish_reason: 'tool_calls',
					id: 'chatcmpl-1',
					model: 'ws/dep-1',
					tool_calls: [
						{
							id: 'call_1',
							type: 'function',
							function: { name: 'get_weather', arguments: '{"city":"Berlin"}' },
						},
					],
				},
			},
		]);
	});

	it('returns one item per OpenAI chunk when Stream is on and Simplify Output is off', async () => {
		const { context, stream } = createStreamContext({
			params: { ...CHAT_COMPLETIONS_PARAMS, stream: true, simplify: false },
		});

		const first = openaiChunk({ role: 'assistant', content: 'Hi' });
		const resultPromise = executeService.call(context, 'chatCompletions', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord(first));
		stream.emit('end');

		expect(await resultPromise).toEqual([{ json: first }]);
	});

	it('relays streamed delta text via sendChunk and skips the [DONE] sentinel', async () => {
		const { context, stream, sendChunk } = createStreamContext({
			params: { ...CHAT_COMPLETIONS_PARAMS, stream: true },
			isStreaming: true,
		});

		const resultPromise = executeService.call(context, 'chatCompletions', 0);
		await flushMicrotasks();
		stream.emit('data', sseRecord(openaiChunk({ role: 'assistant', content: 'Hel' })));
		stream.emit('data', sseRecord(openaiChunk({ content: 'lo' })));
		stream.emit('data', 'data: [DONE]\n\n');
		stream.emit('end');
		await resultPromise;

		expect(sendChunk).toHaveBeenNthCalledWith(1, 'begin', 0);
		expect(sendChunk).toHaveBeenNthCalledWith(2, 'item', 0, 'Hel');
		expect(sendChunk).toHaveBeenNthCalledWith(3, 'item', 0, 'lo');
		expect(sendChunk).toHaveBeenNthCalledWith(4, 'end', 0);
	});

	it('throws when the stream reports an OpenAI error object', async () => {
		const { context, stream, sendChunk } = createStreamContext({
			params: { ...CHAT_COMPLETIONS_PARAMS, stream: true },
			isStreaming: true,
		});

		const resultPromise = executeService.call(context, 'chatCompletions', 0);
		await flushMicrotasks();
		stream.emit(
			'data',
			sseRecord({ error: { message: 'Upstream pipeline failed', type: 'server_error' } }),
		);
		stream.emit('end');

		await expect(resultPromise).rejects.toThrow(/Upstream pipeline failed/);
		expect(sendChunk).toHaveBeenCalledWith('error', 0, 'Upstream pipeline failed');
	});
});
