import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import {
	apiRequest,
	consumeSseStream,
	extractPaginatedList,
	extractSearchSessionList,
	extractStreamErrorDetail,
	extractWorkspaceList,
	fetchPaginatedResults,
	getApiBaseUrlFromCredentials,
	getCredentialType,
	loadDeploymentOptions,
	loadDeploymentOptionsWithAllOption,
	loadFileOptions,
	loadIndexOptions,
	loadSearchSessionOptions,
	loadWorkspaceOptions,
	normalizeApiOrigin,
	parseJsonField,
	readAdditionalParameters,
	withServiceActivationRetry,
} from '../../nodes/HaystackEnterprise/utils';
import { FakeStream } from './testHelpers';

function createContext<T = ILoadOptionsFunctions>(
	httpRequestWithAuthentication: (...args: unknown[]) => unknown,
	credentials: IDataObject = { apiKey: 'test-key' },
): T {
	return {
		helpers: { httpRequestWithAuthentication },
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			name === 'authentication' ? 'apiKey' : fallback,
		getCredentials: async () => credentials,
	} as unknown as T;
}

function createLoadOptionsContext(
	httpRequestWithAuthentication: (...args: unknown[]) => unknown,
	workspaceName = 'ws',
	credentials: IDataObject = { apiKey: 'test-key' },
): ILoadOptionsFunctions {
	return {
		helpers: { httpRequestWithAuthentication },
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
		getNodeParameter: (name: string) =>
			name === 'authentication' ? 'apiKey' : name === 'workspaceName' ? workspaceName : undefined,
		getCredentials: async () => credentials,
	} as unknown as ILoadOptionsFunctions;
}

describe('normalizeApiOrigin', () => {
	it('trims whitespace and trailing slashes', () => {
		expect(normalizeApiOrigin('  https://haystack.example.com/  ')).toBe(
			'https://haystack.example.com',
		);
	});
});

describe('getApiBaseUrlFromCredentials', () => {
	it('defaults to production when serverUrl is missing', () => {
		expect(getApiBaseUrlFromCredentials({ apiKey: 'k' })).toBe(
			'https://api.cloud.deepset.ai/api/v1',
		);
	});

	it('derives v1 from a custom server URL', () => {
		expect(getApiBaseUrlFromCredentials({ apiKey: 'k', serverUrl: 'https://dev.internal/' })).toBe(
			'https://dev.internal/api/v1',
		);
	});

	it('does not duplicate a version path supplied in the Server URL', () => {
		expect(
			getApiBaseUrlFromCredentials({
				apiKey: 'k',
				serverUrl: 'https://dev.internal/api/v1',
			}),
		).toBe('https://dev.internal/api/v1');
	});
});

describe('extractWorkspaceList', () => {
	it('accepts a bare array response', () => {
		expect(extractWorkspaceList([{ name: 'a' }, { name: 'b' }])).toEqual([
			{ name: 'a' },
			{ name: 'b' },
		]);
	});

	it('returns an empty list for a non-array response', () => {
		expect(extractWorkspaceList({ foo: 'bar' })).toEqual([]);
		expect(extractWorkspaceList(null)).toEqual([]);
		expect(extractWorkspaceList(undefined)).toEqual([]);
	});
});

describe('loadWorkspaceOptions', () => {
	it('maps workspaces to name/value options, matching the /api/v1/workspaces response shape', async () => {
		const context = createContext(async () => [
			{
				name: 'wesley',
				workspace_id: '077da66c-c5f1-48f9-ab08-aed31f04cd8f',
				languages: {},
				default_idle_timeout_in_seconds: 1200,
				member_count: 0,
			},
			{
				name: 'default',
				workspace_id: 'b085a1db-1b15-4091-8051-a5354a428fd4',
				languages: null,
				default_idle_timeout_in_seconds: 1200,
				member_count: 103,
			},
		]);

		const options = await loadWorkspaceOptions(context);

		expect(options).toEqual([
			{ name: 'Wesley', value: 'wesley' },
			{ name: 'Default', value: 'default' },
		]);
	});

	it('skips entries without a string name', async () => {
		const context = createContext(async () => [{ name: 'workspace-a' }, { id: 'no-name' }]);

		const options = await loadWorkspaceOptions(context);

		expect(options).toEqual([{ name: 'Workspace-a', value: 'workspace-a' }]);
	});

	// Load-options methods must throw NodeOperationError: n8n's UI shows "[object Object]" for a rethrown NodeApiError.
	it('throws a NodeOperationError (not a NodeApiError) on request failure, preserving the message', async () => {
		const context = createContext(async () => {
			throw Object.assign(new Error('Request failed with status code 403'), {
				response: { status: 403, data: { errors: ['Forbidden'] } },
			});
		});

		const error = await loadWorkspaceOptions(context).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error).not.toBeInstanceOf(NodeApiError);
		expect((error as NodeOperationError).message).toMatch(
			/doesn't have access to this workspace.*org-wide one/s,
		);
	});
});

describe('loadDeploymentOptions', () => {
	// Regression: a workspace the key cannot access, then opening "Service Name or ID".
	it('throws a NodeOperationError with the resource-specific hint on a 403, not a raw NodeApiError', async () => {
		const context = createLoadOptionsContext(async () => {
			throw Object.assign(new Error('Request failed with status code 403'), {
				response: { status: 403, data: { errors: ['Forbidden'] } },
			});
		});

		const error = await loadDeploymentOptions(context).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error).not.toBeInstanceOf(NodeApiError);
		expect((error as NodeOperationError).message).toMatch(
			/can't access this workspace.*lacks permission for this service/s,
		);
	});

	it('returns an empty list when no workspace is selected yet', async () => {
		const context = createLoadOptionsContext(async () => ({ data: [] }), '');

		expect(await loadDeploymentOptions(context)).toEqual([]);
	});
});

describe('loadDeploymentOptionsWithAllOption', () => {
	it('prepends an "All Services" option ahead of the real deployments', async () => {
		const context = createLoadOptionsContext(async () => ({
			data: [{ deployment_id: 'dep-1', name: 'My Service', status: 'DEPLOYED' }],
		}));

		expect(await loadDeploymentOptionsWithAllOption(context)).toEqual([
			{ name: 'All Services', value: '' },
			{ name: 'My Service (DEPLOYED)', value: 'dep-1' },
		]);
	});
});

describe('getCredentialType', () => {
	it('picks the API key credential when selected', () => {
		const context = {
			getNodeParameter: vi.fn(() => 'apiKey'),
		} as unknown as IExecuteFunctions;

		expect(getCredentialType(context)).toBe('haystackEnterpriseApi');
	});

	it('picks the OAuth2 credential on an execute context, reading item index 0', () => {
		const getNodeParameter = vi.fn(() => 'oAuth2');
		const context = { getNodeParameter } as unknown as IExecuteFunctions;

		expect(getCredentialType(context)).toBe('haystackEnterpriseOAuth2Api');
		expect(getNodeParameter).toHaveBeenCalledWith('authentication', 0);
	});

	it('picks the OAuth2 credential on a load-options context', () => {
		const getNodeParameter = vi.fn(() => 'oAuth2');
		const context = {
			getNodeParameter,
			getCurrentNodeParameter: vi.fn(),
		} as unknown as ILoadOptionsFunctions;

		expect(getCredentialType(context)).toBe('haystackEnterpriseOAuth2Api');
		expect(getNodeParameter).toHaveBeenCalledWith('authentication');
	});
});

describe('apiRequest', () => {
	it("authenticates with the OAuth2 credential type when the node's Authentication is OAuth2", async () => {
		const httpRequestWithAuthentication = vi.fn(async () => ({}));
		const getCredentials = vi.fn(async () => ({ oauthTokenData: { access_token: 'token' } }));
		const context = {
			helpers: { httpRequestWithAuthentication },
			getNode: () => ({ name: 'Haystack Enterprise AI' }),
			getCredentials,
			getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
				name === 'authentication' ? 'oAuth2' : fallback,
		} as unknown as IExecuteFunctions;

		await apiRequest.call(context, 'GET', '/workspaces');

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseOAuth2Api',
			expect.objectContaining({ method: 'GET', url: expect.stringContaining('/workspaces') }),
		);
		expect(getCredentials).toHaveBeenCalledWith('haystackEnterpriseOAuth2Api');
	});

	it('sends X-Organization-ID for OAuth2 credentials only', async () => {
		const run = async (authentication: string, credentials: Record<string, unknown>) => {
			const httpRequestWithAuthentication = vi.fn(async () => ({}));
			const context = {
				helpers: { httpRequestWithAuthentication },
				getNode: () => ({ name: 'Haystack Enterprise AI' }),
				getCredentials: async () => credentials,
				getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
					name === 'authentication' ? authentication : fallback,
			} as unknown as IExecuteFunctions;
			await apiRequest.call(context, 'GET', '/workspaces', { headers: { 'X-Other': '1' } });
			return (httpRequestWithAuthentication.mock.calls[0] as unknown[])[1] as {
				headers?: Record<string, string>;
			};
		};

		expect((await run('oAuth2', { organizationId: ' org-1 ' })).headers).toEqual({
			'X-Other': '1',
			'X-Organization-ID': 'org-1',
		});
		expect((await run('oAuth2', { organizationId: '' })).headers).toEqual({ 'X-Other': '1' });
		expect((await run('apiKey', { apiKey: 'k', organizationId: 'org-1' })).headers).toEqual({
			'X-Other': '1',
		});
	});

	it('uses the Server URL from credentials when building the request URL', async () => {
		const httpRequestWithAuthentication = vi.fn(async () => ({ ok: true }));
		const context = createContext(httpRequestWithAuthentication, {
			apiKey: 'test-key',
			serverUrl: 'https://self-hosted.example.com',
		});

		await apiRequest.call(context, 'GET', '/workspaces');

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				url: 'https://self-hosted.example.com/api/v1/workspaces',
			}),
		);
	});

	// n8n's httpRequestWithAuthentication wraps failures in a NodeApiError (raw error on `.cause`) and the constructor ignores options for an already-wrapped error, so apiRequest() must mutate `.description`.
	function throwPreWrapped(node: { name: string }, rawError: Error) {
		throw new NodeApiError(node, rawError as unknown as Record<string, unknown>);
	}

	// API errors come as `{ errors: string[] }` or `{ detail }`, which NodeApiError doesn't recognize, so they must be extracted explicitly.
	it("surfaces deepset's `errors` array from the pre-wrapped NodeApiError as the description", async () => {
		const node = { name: 'Haystack Enterprise AI' };
		const context = createContext(async () => {
			throwPreWrapped(
				node,
				Object.assign(new Error('Request failed with status code 500'), {
					response: {
						status: 500,
						data: { errors: ['Pipeline execution failed: missing component X'] },
					},
				}),
			);
		});
		Object.assign(context, { getNode: () => node });

		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			description: 'Pipeline execution failed: missing component X',
		});
	});

	it('joins multiple `errors` entries into a readable description', async () => {
		const node = { name: 'Haystack Enterprise AI' };
		const context = createContext(async () => {
			throwPreWrapped(
				node,
				Object.assign(new Error('Request failed with status code 500'), {
					response: { status: 500, data: { errors: ['missing component X', 'invalid config Y'] } },
				}),
			);
		});
		Object.assign(context, { getNode: () => node });

		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			description: 'missing component X; invalid config Y',
		});
	});

	it('reads { errors } from a NodeApiError created by a different n8n-workflow copy and replaces Full message', async () => {
		class ForeignNodeApiError extends Error {
			httpCode = '409';
			description?: string;
			messages = ['Request failed with status code 409'];
			context = { data: { errors: ["Deployment 'my test service' has no active revision."] } };

			constructor() {
				super('Your request is invalid or could not be processed by the service');
				this.name = 'NodeApiError';
			}
		}

		const foreign = new ForeignNodeApiError();
		const context = createContext(async () => {
			throw foreign;
		});

		await expect(
			apiRequest.call(context, 'POST', '/workspaces/ws/deployments/dep/chat'),
		).rejects.toBe(foreign);
		expect(foreign.message).toBe("Deployment 'my test service' has no active revision.");
		expect(foreign.messages).toEqual(["Deployment 'my test service' has no active revision."]);
	});

	it('joins validation { details: [{ message }] } entries', async () => {
		const context = createContext(async () => {
			throw Object.assign(new Error('Request failed with status code 400'), {
				response: {
					status: 400,
					data: {
						details: [
							{ code: 'INVALID_YAML', message: 'invalid yaml' },
							{ code: 'MISSING_INPUT', message: 'query is required' },
						],
					},
				},
			});
		});

		await expect(
			apiRequest.call(context, 'POST', '/workspaces/ws/pipelines'),
		).rejects.toMatchObject({
			message: 'invalid yaml; query is required',
		});
	});

	it('shows the API detail as the error message, not n8n’s generic status text', async () => {
		const node = { name: 'Haystack Enterprise AI' };
		const context = createContext(async () => {
			throwPreWrapped(
				node,
				Object.assign(new Error('Request failed with status code 409'), {
					response: {
						status: 409,
						data: { errors: ['This service has no runnable revision.'] },
					},
				}),
			);
		});
		Object.assign(context, { getNode: () => node });

		await expect(
			apiRequest.call(context, 'POST', '/workspaces/ws/deployments/dep/chat'),
		).rejects.toMatchObject({
			httpCode: '409',
			message: 'This service has no runnable revision.',
			description: 'This service has no runnable revision.',
			messages: ['This service has no runnable revision.'],
		});
	});

	it('surfaces a string `detail` from the error response as the NodeApiError description', async () => {
		const context = createContext(async () => {
			throw Object.assign(new Error('Request failed with status code 500'), {
				response: {
					status: 500,
					data: { detail: 'Pipeline execution failed: missing component X' },
				},
			});
		});

		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			description: 'Pipeline execution failed: missing component X',
		});
	});

	it('joins validation error `detail` arrays into a readable description', async () => {
		const context = createContext(async () => {
			throw Object.assign(new Error('Request failed with status code 422'), {
				response: {
					status: 422,
					data: {
						detail: [
							{ loc: ['body', 'query'], msg: 'field required', type: 'value_error.missing' },
							{ loc: ['body', 'pipeline_id'], msg: 'invalid uuid', type: 'value_error' },
						],
					},
				},
			});
		});

		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			description: 'field required; invalid uuid',
		});
	});

	it('falls back to `message` on the error response when there is no `detail` or `errors`', async () => {
		const context = createContext(async () => {
			throw Object.assign(new Error('Request failed with status code 500'), {
				response: { status: 500, data: { message: 'Something else went wrong' } },
			});
		});

		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			description: 'Something else went wrong',
		});
	});

	it('surfaces OpenAI-style `{ error: { message } }` bodies as the NodeApiError description', async () => {
		const context = createContext(async () => {
			throw Object.assign(new Error('Request failed with status code 500'), {
				response: {
					status: 500,
					data: {
						error: {
							message: 'Internal server error',
							type: 'server_error',
							param: null,
							code: null,
						},
					},
				},
			});
		});

		await expect(
			apiRequest.call(context, 'POST', '/workspaces/ws/deployments/v1/chat/completions'),
		).rejects.toMatchObject({
			description: 'Internal server error',
		});
	});

	it('falls back to NodeApiError default extraction when the error response has no recognizable detail', async () => {
		const context = createContext(async () => {
			throw Object.assign(new Error('Request failed with status code 500'), {
				response: { status: 500, data: {} },
			});
		});

		// Without an explicit description, NodeApiError falls back to the raw HTTP error's `.message`.
		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			description: 'Request failed with status code 500',
		});
	});

	// A 403 loading a workspace-scoped dropdown usually means a workspace-scoped key with the wrong workspace.
	it('replaces the message with a workspace-access hint on a 403, instead of the raw HTTP wrapper text', async () => {
		const node = { name: 'Haystack Enterprise AI' };
		const context = createContext(async () => {
			throwPreWrapped(
				node,
				Object.assign(new Error('Request failed with status code 403'), {
					response: { status: 403, data: { errors: ['Forbidden'] } },
				}),
			);
		});
		Object.assign(context, { getNode: () => node });

		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			message: expect.stringMatching(/doesn't have access to this workspace.*org-wide one/s),
		});
	});

	// A resource-endpoint 403 is ambiguous: the key may see the workspace but lack permission on that resource.
	it.each([
		['GET', '/workspaces/ws-1/deployments/dep-1', 'service'],
		['GET', '/workspaces/ws-1/indexes/my-index', 'index'],
		['GET', '/workspaces/ws-1/files/file-1', 'file'],
		['DELETE', '/workspaces/ws-1/search_sessions/session-1', 'search session'],
	] as const)(
		'mentions both possible causes for a 403 on a %s %s endpoint',
		async (method, endpoint, resource) => {
			const node = { name: 'Haystack Enterprise AI' };
			const context = createContext(async () => {
				throwPreWrapped(
					node,
					Object.assign(new Error('Request failed with status code 403'), {
						response: { status: 403, data: { errors: ['Forbidden'] } },
					}),
				);
			});
			Object.assign(context, { getNode: () => node });

			await expect(apiRequest.call(context, method, endpoint)).rejects.toMatchObject({
				message: expect.stringMatching(
					new RegExp(`can't access this workspace.*lacks permission for this ${resource}`, 's'),
				),
			});
		},
	);

	it('replaces the message with a credential hint on a 401', async () => {
		const context = createContext(async () => {
			throw Object.assign(new Error('Request failed with status code 401'), {
				response: { status: 401, data: { errors: ['Unauthorized'] } },
			});
		});

		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			message: expect.stringMatching(/API key.*valid/),
		});
	});

	// Regression: a 403 on a dropdown showed "[object Object]" when NodeApiError could not resolve an HTTP status and left a raw object in `.message`.
	it("never leaves .message as a non-string object when the HTTP status code can't be determined", async () => {
		const node = { name: 'Haystack Enterprise AI' };
		const context = createContext(async () => {
			throwPreWrapped(
				node,
				Object.assign(new Error('unused'), {
					// No status anywhere, so `.httpCode` stays null and `.message` remains the raw object.
					message: { errors: ['Internal error'] } as unknown as string,
				}),
			);
		});
		Object.assign(context, { getNode: () => node });

		const error = await apiRequest
			.call(context, 'GET', '/workspaces')
			.catch((caught: unknown) => caught);

		expect(typeof (error as { message: unknown }).message).toBe('string');
		expect((error as Error).message).not.toBe('[object Object]');
	});

	// Variant: `new Error(body)` stringifies an object body to the literal "[object Object]", which a typeof check misses.
	it('replaces .message even when it was already coerced to the literal string "[object Object]" upstream', async () => {
		const node = { name: 'Haystack Enterprise AI' };
		const context = createContext(async () => {
			throwPreWrapped(
				node,
				Object.assign(new Error('unused'), {
					message: '[object Object]',
					response: { data: { errors: ['Internal error'] } },
				}),
			);
		});
		Object.assign(context, { getNode: () => node });

		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			message: 'Internal error',
		});
	});

	// The error shape exposes no status (`.httpCode` null), so the body text "Forbidden"/"Unauthorized" is the fallback signal.
	it("classifies a 403 from the error text alone when the HTTP status code can't be determined", async () => {
		const node = { name: 'Haystack Enterprise AI' };
		const context = createContext(async () => {
			throwPreWrapped(
				node,
				Object.assign(new Error('unused'), {
					// `.response.data` is present but no status, so `.httpCode` stays null.
					response: { data: { errors: ['Forbidden'] } },
				}),
			);
		});
		Object.assign(context, { getNode: () => node });

		await expect(
			apiRequest.call(context, 'GET', '/workspaces/ws-1/deployments/dep-1'),
		).rejects.toMatchObject({
			message: expect.stringMatching(
				/can't access this workspace.*lacks permission for this service/s,
			),
		});
	});

	it("classifies a 401 from the error text alone when the HTTP status code can't be determined", async () => {
		const node = { name: 'Haystack Enterprise AI' };
		const context = createContext(async () => {
			throwPreWrapped(
				node,
				Object.assign(new Error('unused'), {
					response: { data: { errors: ['Unauthorized'] } },
				}),
			);
		});
		Object.assign(context, { getNode: () => node });

		await expect(apiRequest.call(context, 'GET', '/workspaces')).rejects.toMatchObject({
			message: expect.stringMatching(/API key.*valid/),
		});
	});
});

describe('extractStreamErrorDetail', () => {
	it('uses a plain string error as-is', () => {
		expect(extractStreamErrorDetail('Pipeline execution failed')).toEqual({
			message: 'Pipeline execution failed',
			data: 'Pipeline execution failed',
		});
	});

	it('takes the first item of an `{ errors: [...] }` payload as the message, keeping the full payload as data', () => {
		expect(
			extractStreamErrorDetail({ errors: ['missing component X', 'invalid config Y'] }),
		).toEqual({
			message: 'missing component X',
			data: { errors: ['missing component X', 'invalid config Y'] },
		});
	});

	it('uses an OpenAI-style `{ message }` payload as the message, keeping the full payload as data', () => {
		expect(
			extractStreamErrorDetail({ message: 'Upstream pipeline failed', type: 'server_error' }),
		).toEqual({
			message: 'Upstream pipeline failed',
			data: { message: 'Upstream pipeline failed', type: 'server_error' },
		});
	});

	it('uses an OpenAI-style `{ error: { message } }` envelope as the message', () => {
		const payload = {
			error: {
				message: 'Internal server error',
				type: 'server_error',
				param: null,
				code: null,
			},
		};
		expect(extractStreamErrorDetail(payload)).toEqual({
			message: 'Internal server error',
			data: payload,
		});
	});

	it('uses a string `detail` and falls back when the payload has no message', () => {
		expect(extractStreamErrorDetail({ detail: 'something else' })).toEqual({
			message: 'something else',
			data: { detail: 'something else' },
		});
		expect(extractStreamErrorDetail({ type: 'error' })).toEqual({
			message: 'The stream returned an unknown error',
			data: { type: 'error' },
		});
		expect(extractStreamErrorDetail(undefined)).toEqual({
			message: 'The stream returned an unknown error',
			data: undefined,
		});
	});
});

describe('extractSearchSessionList', () => {
	it('reads the search_sessions array', () => {
		const response = { search_sessions: [{ search_session_id: 'a' }], has_more: false, total: 1 };
		expect(extractSearchSessionList(response)).toEqual([{ search_session_id: 'a' }]);
	});

	it('returns an empty list for a non-matching response', () => {
		expect(extractSearchSessionList({ data: [{ a: 1 }] })).toEqual([]);
		expect(extractSearchSessionList(null)).toEqual([]);
		expect(extractSearchSessionList(undefined)).toEqual([]);
	});
});

describe('loadSearchSessionOptions', () => {
	it('maps sessions to name/value options, preferring title over ID', async () => {
		const context = createLoadOptionsContext(async () => ({
			search_sessions: [
				{ search_session_id: 'session-1', title: 'Support chat' },
				{ search_session_id: 'session-2', title: null },
			],
			has_more: false,
			total: 2,
		}));

		const options = await loadSearchSessionOptions(context);

		expect(options).toEqual([
			{ name: 'Support chat', value: 'session-1' },
			{ name: 'session-2', value: 'session-2' },
		]);
	});

	it('returns an empty list when no workspace is selected yet', async () => {
		const context = createLoadOptionsContext(async () => ({ search_sessions: [] }), '');

		expect(await loadSearchSessionOptions(context)).toEqual([]);
	});
});

describe('consumeSseStream', () => {
	it('parses multiple SSE events separated by blank lines', async () => {
		const stream = new FakeStream();
		const events: IDataObject[] = [];

		const done = consumeSseStream(stream as unknown as NodeJS.ReadableStream, (event) =>
			events.push(event),
		);
		stream.emit(
			'data',
			'data: {"type":"delta","delta":{"text":"Hel"}}\n\ndata: {"type":"delta","delta":{"text":"lo"}}\n\n',
		);
		stream.emit('end');
		await done;

		expect(events).toEqual([
			{ type: 'delta', delta: { text: 'Hel' } },
			{ type: 'delta', delta: { text: 'lo' } },
		]);
	});

	it('reassembles an event whose data arrives split across multiple chunks', async () => {
		const stream = new FakeStream();
		const events: IDataObject[] = [];

		const done = consumeSseStream(stream as unknown as NodeJS.ReadableStream, (event) =>
			events.push(event),
		);
		stream.emit('data', 'data: {"type":"delta",');
		stream.emit('data', '"delta":{"text":"hi"}}\n\n');
		stream.emit('end');
		await done;

		expect(events).toEqual([{ type: 'delta', delta: { text: 'hi' } }]);
	});

	it('handles CRLF line endings split across chunk boundaries', async () => {
		const stream = new FakeStream();
		const events: IDataObject[] = [];

		const done = consumeSseStream(stream as unknown as NodeJS.ReadableStream, (event) =>
			events.push(event),
		);
		stream.emit('data', 'data: {"a":1}\r\n\r');
		stream.emit('data', '\ndata: {"b":2}\r');
		stream.emit('data', '\n\r\n');
		stream.emit('end');
		await done;

		expect(events).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it('decodes a multibyte character split across byte chunks', async () => {
		const stream = new FakeStream();
		const events: IDataObject[] = [];

		const done = consumeSseStream(stream as unknown as NodeJS.ReadableStream, (event) =>
			events.push(event),
		);
		const bytes = Buffer.from('data: {"text":"€"}\n\n');
		const split = bytes.indexOf(0xe2) + 1; // mid-way through the 3-byte euro sign
		stream.emit('data', bytes.subarray(0, split));
		stream.emit('data', bytes.subarray(split));
		stream.emit('end');
		await done;

		expect(events).toEqual([{ text: '€' }]);
	});

	it('ignores keep-alive comments and unparseable records without dropping valid ones', async () => {
		const stream = new FakeStream();
		const events: IDataObject[] = [];

		const done = consumeSseStream(stream as unknown as NodeJS.ReadableStream, (event) =>
			events.push(event),
		);
		stream.emit('data', ': keep-alive\n\ndata: not valid json\n\ndata: {"type":"ping"}\n\n');
		stream.emit('end');
		await done;

		expect(events).toEqual([{ type: 'ping' }]);
	});

	it('normalizes CRLF line endings', async () => {
		const stream = new FakeStream();
		const events: IDataObject[] = [];

		const done = consumeSseStream(stream as unknown as NodeJS.ReadableStream, (event) =>
			events.push(event),
		);
		stream.emit('data', 'data: {"type":"ping"}\r\n\r\n');
		stream.emit('end');
		await done;

		expect(events).toEqual([{ type: 'ping' }]);
	});

	it('rejects when the underlying stream errors', async () => {
		const stream = new FakeStream();
		const onEvent = vi.fn();

		const done = consumeSseStream(stream as unknown as NodeJS.ReadableStream, onEvent);
		stream.emit('error', new Error('connection reset'));

		await expect(done).rejects.toThrow('connection reset');
		expect(onEvent).not.toHaveBeenCalled();
	});
});

describe('extractPaginatedList', () => {
	it('reads the data array', () => {
		expect(extractPaginatedList({ data: [{ id: 'a' }], has_more: false, total: 1 })).toEqual([
			{ id: 'a' },
		]);
	});

	it('returns an empty list for a non-matching response', () => {
		expect(extractPaginatedList({ search_sessions: [{ id: 'a' }] })).toEqual([]);
		expect(extractPaginatedList(null)).toEqual([]);
		expect(extractPaginatedList(undefined)).toEqual([]);
	});
});

describe('fetchPaginatedResults', () => {
	const createExecuteContext = (httpRequestWithAuthentication: (...args: unknown[]) => unknown) =>
		createContext<IExecuteFunctions>(httpRequestWithAuthentication);

	it('fetches a single page when returnAll is false, using the given limit and page_number 1', async () => {
		const httpRequestWithAuthentication = vi.fn(async () => ({
			data: [{ id: 'a' }],
			has_more: true,
			total: 5,
		}));
		const context = createExecuteContext(httpRequestWithAuthentication);

		const result = await fetchPaginatedResults(
			context,
			'/workspaces/ws/deployments',
			{ field: 'name' },
			false,
			25,
			extractPaginatedList,
		);

		expect(result).toEqual([{ id: 'a' }]);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({ qs: { field: 'name', limit: 25, page_number: 1 } }),
		);
	});

	it('walks every page and flattens the results when returnAll is true', async () => {
		let call = 0;
		const httpRequestWithAuthentication = vi.fn(async () => {
			call += 1;
			if (call === 1) return { data: [{ id: 'a' }], has_more: true, total: 2 };
			return { data: [{ id: 'b' }], has_more: false, total: 2 };
		});
		const context = createExecuteContext(httpRequestWithAuthentication);

		const result = await fetchPaginatedResults(
			context,
			'/workspaces/ws/deployments',
			{},
			true,
			100,
			extractPaginatedList,
		);

		expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
		expect(httpRequestWithAuthentication).toHaveBeenNthCalledWith(
			1,
			'haystackEnterpriseApi',
			expect.objectContaining({ qs: { limit: 100, page_number: 1 } }),
		);
		expect(httpRequestWithAuthentication).toHaveBeenNthCalledWith(
			2,
			'haystackEnterpriseApi',
			expect.objectContaining({ qs: { limit: 100, page_number: 2 } }),
		);
	});

	it('stops after the first page when it already reports has_more: false, even with returnAll on', async () => {
		const httpRequestWithAuthentication = vi.fn(async () => ({
			data: [],
			has_more: false,
			total: 0,
		}));
		const context = createExecuteContext(httpRequestWithAuthentication);

		const result = await fetchPaginatedResults(
			context,
			'/workspaces/ws/indexes',
			{},
			true,
			100,
			extractPaginatedList,
		);

		expect(result).toEqual([]);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
	});

	it('uses a caller-supplied extractList to read a differently-shaped response', async () => {
		const httpRequestWithAuthentication = vi.fn(async () => ({
			search_sessions: [{ search_session_id: 's1' }],
			has_more: false,
			total: 1,
		}));
		const context = createExecuteContext(httpRequestWithAuthentication);

		const result = await fetchPaginatedResults(
			context,
			'/workspaces/ws/search_sessions',
			{},
			false,
			50,
			extractSearchSessionList,
		);

		expect(result).toEqual([{ search_session_id: 's1' }]);
	});
});

describe('loadFileOptions', () => {
	it('maps files to name/value options, preferring the file name over its ID', async () => {
		const context = createLoadOptionsContext(async () => ({
			data: [{ file_id: 'f1', name: 'report.pdf' }, { file_id: 'f2' }],
			has_more: false,
			total: 2,
		}));

		expect(await loadFileOptions(context)).toEqual([
			{ name: 'report.pdf', value: 'f1' },
			{ name: 'f2', value: 'f2' },
		]);
	});

	it('skips entries without a string file_id', async () => {
		const context = createLoadOptionsContext(async () => ({
			data: [{ name: 'no-id' }],
			has_more: false,
			total: 1,
		}));

		expect(await loadFileOptions(context)).toEqual([]);
	});

	it('returns an empty list when no workspace is selected yet', async () => {
		const context = createLoadOptionsContext(async () => ({ data: [] }), '');
		expect(await loadFileOptions(context)).toEqual([]);
	});
});

describe('loadIndexOptions', () => {
	it('maps indexes to name/value options, appending the desired status', async () => {
		const context = createLoadOptionsContext(async () => ({
			data: [{ name: 'my-index', desired_status: 'DEPLOYED' }],
			has_more: false,
			total: 1,
		}));

		expect(await loadIndexOptions(context)).toEqual([
			{ name: 'my-index (DEPLOYED)', value: 'my-index' },
		]);
	});

	it('omits the status suffix when desired_status is missing or not a string', async () => {
		const context = createLoadOptionsContext(async () => ({
			data: [{ name: 'my-index' }],
			has_more: false,
			total: 1,
		}));

		expect(await loadIndexOptions(context)).toEqual([{ name: 'my-index', value: 'my-index' }]);
	});

	it('skips entries without a string name', async () => {
		const context = createLoadOptionsContext(async () => ({
			data: [{ desired_status: 'DEPLOYED' }],
			has_more: false,
			total: 1,
		}));

		expect(await loadIndexOptions(context)).toEqual([]);
	});

	it('returns an empty list when no workspace is selected yet', async () => {
		const context = createLoadOptionsContext(async () => ({ data: [] }), '');
		expect(await loadIndexOptions(context)).toEqual([]);
	});
});

describe('parseJsonField', () => {
	const context = {
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
	} as unknown as IExecuteFunctions;

	it('returns undefined for an empty or whitespace-only string', () => {
		expect(parseJsonField.call(context, 0, 'Filters (JSON)', '')).toBeUndefined();
		expect(parseJsonField.call(context, 0, 'Filters (JSON)', '   ')).toBeUndefined();
	});

	it('returns undefined for a non-string value (e.g. the field left at its default)', () => {
		expect(parseJsonField.call(context, 0, 'Filters (JSON)', undefined)).toBeUndefined();
		expect(parseJsonField.call(context, 0, 'Filters (JSON)', 42)).toBeUndefined();
	});

	it('parses a valid JSON string', () => {
		expect(parseJsonField.call(context, 0, 'Filters (JSON)', '{"a":1}')).toEqual({ a: 1 });
	});

	it('throws a NodeOperationError naming the offending field when the JSON is invalid', () => {
		expect(() => parseJsonField.call(context, 0, 'Filters (JSON)', '{not valid')).toThrow(
			NodeOperationError,
		);
		expect(() => parseJsonField.call(context, 0, 'Filters (JSON)', '{not valid')).toThrow(
			/"Filters \(JSON\)" is not valid JSON/,
		);
	});
});

describe('readAdditionalParameters', () => {
	const context = {
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
	} as unknown as IExecuteFunctions;

	it('returns an empty object when the field is omitted or empty', () => {
		expect(readAdditionalParameters.call(context, 0, undefined)).toEqual({});
		expect(readAdditionalParameters.call(context, 0, '')).toEqual({});
		expect(readAdditionalParameters.call(context, 0, '{}')).toEqual({});
	});

	it('parses a JSON string or an already-parsed object and drops reserved keys', () => {
		expect(
			readAdditionalParameters.call(context, 0, '{"new_field":1,"queries":["nope"]}', ['queries']),
		).toEqual({ new_field: 1 });
		expect(readAdditionalParameters.call(context, 0, { temperature: 0.2 })).toEqual({
			temperature: 0.2,
		});
	});

	it('rejects invalid JSON and non-objects', () => {
		expect(() => readAdditionalParameters.call(context, 0, '{not valid')).toThrow(
			/"Extra Parameters \(JSON\)" is not valid JSON/,
		);
		expect(() => readAdditionalParameters.call(context, 0, '[]')).toThrow(
			/"Extra Parameters \(JSON\)" must be a JSON object/,
		);
	});
});

describe('withServiceActivationRetry', () => {
	const context = {
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
	} as unknown as IExecuteFunctions;

	function activatingError() {
		return new NodeApiError(context.getNode(), {
			httpCode: '591',
			message: 'Service is not active',
		} as unknown as Record<string, unknown>);
	}

	it('runs fn exactly once and rethrows when enabled is false, even for a 591', async () => {
		const fn = vi.fn(async () => {
			throw activatingError();
		});

		await expect(
			withServiceActivationRetry.call(context, fn, false, 60_000),
		).rejects.toBeInstanceOf(NodeApiError);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('returns the result immediately on the first success without sleeping', async () => {
		const fn = vi.fn(async () => 'ok');

		await expect(withServiceActivationRetry.call(context, fn, true, 60_000)).resolves.toBe('ok');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('does not retry a non-591 error, even with retries enabled', async () => {
		const fn = vi.fn(async () => {
			throw new NodeApiError(context.getNode(), {
				httpCode: '500',
				message: 'boom',
			} as unknown as Record<string, unknown>);
		});

		await expect(withServiceActivationRetry.call(context, fn, true, 60_000)).rejects.toBeInstanceOf(
			NodeApiError,
		);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries a 591 with growing backoff until it succeeds', async () => {
		vi.useFakeTimers();
		try {
			let call = 0;
			const fn = vi.fn(async () => {
				call += 1;
				if (call < 3) throw activatingError();
				return 'activated';
			});

			const resultPromise = withServiceActivationRetry.call(context, fn, true, 60_000);
			await vi.runAllTimersAsync();

			await expect(resultPromise).resolves.toBe('activated');
			expect(fn).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it('gives up once maxWaitMs elapses, throwing a fresh NodeApiError for the last failure', async () => {
		vi.useFakeTimers();
		try {
			const fn = vi.fn(async () => {
				throw activatingError();
			});

			const resultPromise = withServiceActivationRetry.call(context, fn, true, 3_000);
			resultPromise.catch(() => {
				// Prevent an unhandled-rejection warning while the assertion below awaits separately.
			});
			await vi.runAllTimersAsync();

			await expect(resultPromise).rejects.toBeInstanceOf(NodeApiError);
			// Attempts at t=0, 2000, 3000; the third failure (3000ms) no longer satisfies `< maxWaitMs`, so it gives up.
			expect(fn).toHaveBeenCalledTimes(3);
		} finally {
			vi.useRealTimers();
		}
	});
});
