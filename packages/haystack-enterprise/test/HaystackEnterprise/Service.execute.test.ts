import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import { executeService } from '../../nodes/HaystackEnterprise/resources/service/Service.execute';

/**
 * Minimal stand-in for a Node.js Readable in 'data'/'end'/'error' mode — all
 * apiRequestStream()/consumeSseStream() actually rely on.
 */
class FakeStream {
	private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

	on(event: string, callback: (...args: unknown[]) => void): this {
		(this.listeners[event] ??= []).push(callback);
		return this;
	}

	emit(event: string, ...args: unknown[]): void {
		for (const callback of this.listeners[event] ?? []) {
			callback(...args);
		}
	}
}

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
}

function createStreamContext({ params, streamRequestError, isStreaming }: StreamContextOptions) {
	const stream = new FakeStream();
	const sendChunk = vi.fn();

	const httpRequestWithAuthentication = vi.fn(async () => {
		// The *-stream endpoint: resolves immediately with the stream, same as
		// the real encoding: 'stream' behavior — the body arrives later via
		// 'data'/'end' events, not by awaiting this call any further.
		if (streamRequestError) throw streamRequestError;
		return stream;
	});

	const context = {
		helpers: { httpRequestWithAuthentication },
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		isStreaming: () => isStreaming ?? false,
		sendChunk,
	} as unknown as IExecuteFunctions;

	return { context, stream, sendChunk, httpRequestWithAuthentication };
}

function createContext(params: Record<string, unknown>, response: Record<string, unknown>) {
	const httpRequestWithAuthentication = vi.fn(async () => response);

	const context = {
		helpers: { httpRequestWithAuthentication },
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
	} as unknown as IExecuteFunctions;

	return { context, httpRequestWithAuthentication };
}

describe('executeService — get many', () => {
	it('returns each service as its own item', async () => {
		const { context } = createContext(
			{ workspaceName: 'ws', returnAll: false, limit: 50, filters: {}, sort: {} },
			{ data: [{ deployment_id: 'a' }, { deployment_id: 'b' }], has_more: false, total: 2 },
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
			{ data: [], has_more: false, total: 0 },
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
			{ data: [{ deployment_id: 'a' }], has_more: false, total: 1 },
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
			{ data: [{ deployment_id: 'b' }], has_more: false, total: 1 },
		);

		await executeService.call(context, 'getAll', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [string, { qs: Record<string, unknown> }];
		expect(options.qs).toMatchObject({ after: 'service-cursor-2' });
		expect(options.qs).not.toHaveProperty('page_number');
	});

	it('ignores before/after and uses page_number pagination when Return All is on', async () => {
		let call = 0;
		const httpRequestWithAuthentication = vi.fn(async () => {
			call += 1;
			if (call === 1) {
				return { data: [{ deployment_id: 'a' }], has_more: true, total: 2 };
			}
			return { data: [{ deployment_id: 'b' }], has_more: false, total: 2 };
		});
		const context = {
			helpers: { httpRequestWithAuthentication },
			getNode: () => ({ name: 'Haystack Enterprise AI' }),
			getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) => {
				const params: Record<string, unknown> = {
					workspaceName: 'ws',
					returnAll: true,
					filters: { before: 'service-cursor-1' },
					sort: {},
				};
				return name in params ? params[name] : fallback;
			},
		} as unknown as IExecuteFunctions;

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

		expect(sendChunk).toHaveBeenNthCalledWith(1, 'begin', 0);
		expect(sendChunk).toHaveBeenNthCalledWith(2, 'item', 0, event);
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

		const createCalls = httpRequestWithAuthentication.mock.calls.filter(([, options]: [unknown, { url: string }]) =>
			options.url.endsWith('/search_sessions'),
		);
		expect(createCalls).toHaveLength(0);

		const streamCall = httpRequestWithAuthentication.mock.calls.find(([, options]: [unknown, { url: string }]) =>
			options.url.endsWith('/chat-stream'),
		);
		expect(streamCall?.[1]).toMatchObject({ body: { query: 'hello', search_session_id: 'existing-session' } });
		expect(result).toEqual([{ json: { content: 'Hi', search_session_id: 'existing-session' } }]);
	});
});
