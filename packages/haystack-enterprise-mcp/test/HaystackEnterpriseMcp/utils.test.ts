import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	buildMcpToolName,
	contentToString,
	createBearerFetch,
	DEFAULT_API_ORIGIN,
	describeToolCallErrorHint,
	describeTransportErrorHint,
	getApiBaseUrlV2FromOrigin,
	getSelectedTools,
	isStructuredContent,
	listAllMcpTools,
	loadMcpToolOptions,
	loadWorkspaceOptions,
	normalizeMcpInputSchema,
	resolveMcpAuth,
} from '../../nodes/HaystackEnterpriseMcp/utils';

const { mockConnect, mockListTools, mockClose, ClientMock, TransportMock } = vi.hoisted(() => {
	const mockConnect = vi.fn();
	const mockListTools = vi.fn();
	const mockClose = vi.fn();
	const ClientMock = vi.fn().mockImplementation(() => ({
		connect: mockConnect,
		listTools: mockListTools,
		close: mockClose,
	}));
	const TransportMock = vi.fn();
	return { mockConnect, mockListTools, mockClose, ClientMock, TransportMock };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: ClientMock }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')>();
	return { ...actual, StreamableHTTPClientTransport: TransportMock };
});

// Load-options contexts use getNodeParameter(name, fallback) without an item index.
function createLoadOptionsContext(
	httpRequestWithAuthentication: (...args: unknown[]) => unknown,
	params: Record<string, unknown> = {},
	credentials: Record<string, unknown> = { apiKey: 'secret-key' },
) {
	return {
		helpers: { httpRequestWithAuthentication },
		getNode: () => ({ name: 'Haystack Enterprise MCP' }),
		getNodeParameter: (name: string, fallback?: unknown) =>
			Object.prototype.hasOwnProperty.call(params, name)
				? params[name]
				: name === 'authentication'
					? 'apiKey'
					: fallback,
		getCurrentNodeParameter: () => undefined,
		getCredentials: async () => credentials,
	} as unknown as ILoadOptionsFunctions;
}

function okResponse() {
	return new Response('{}', { status: 200 });
}

function unauthorizedResponse() {
	return new Response('', { status: 401 });
}

describe('resolveMcpAuth', () => {
	it('uses the API key credential (with no refresh) when Authentication is API Key', async () => {
		const getCredentials = vi.fn(async () => ({ apiKey: 'secret-key' }));
		const context = {
			getNode: () => ({ name: 'Haystack Enterprise MCP' }),
			getNodeParameter: (name: string) => (name === 'authentication' ? 'apiKey' : undefined),
			getCurrentNodeParameter: () => undefined,
			getCredentials,
		} as unknown as IExecuteFunctions;

		const auth = await resolveMcpAuth(context, 0);

		expect(auth).toEqual({ token: 'secret-key', apiOrigin: DEFAULT_API_ORIGIN });
		expect(getCredentials).toHaveBeenCalledWith('haystackEnterpriseApi');
	});

	it('reads the stored OAuth2 access token when Authentication is OAuth2', async () => {
		const getCredentials = vi.fn(async () => ({ oauthTokenData: { access_token: 'oauth-token' } }));
		const context = createLoadOptionsContext(vi.fn(), { authentication: 'oAuth2' });
		Object.assign(context, { getCredentials });

		const auth = await resolveMcpAuth(context, 0);

		expect(auth.token).toBe('oauth-token');
		expect(auth.refresh).toBeTypeOf('function');
		expect(getCredentials).toHaveBeenCalledWith('haystackEnterpriseOAuth2Api');
	});

	it('tells the user to Connect when the OAuth2 credential has no access token yet', async () => {
		const context = {
			getNode: () => ({ name: 'Haystack Enterprise MCP' }),
			getNodeParameter: (name: string) => (name === 'authentication' ? 'oAuth2' : undefined),
			getCredentials: async () => ({}),
		} as unknown as IExecuteFunctions;

		await expect(resolveMcpAuth(context, 0)).rejects.toThrow(/not connected yet.*Connect/);
	});

	it("refreshes through n8n's own refreshOAuth2Token helper and returns the new access token", async () => {
		const refreshOAuth2Token = vi.fn(async () => ({ access_token: 'fresh-token' }));
		const context = {
			getNode: () => ({ name: 'Haystack Enterprise MCP' }),
			getNodeParameter: (name: string) => (name === 'authentication' ? 'oAuth2' : undefined),
			getCredentials: async () => ({ oauthTokenData: { access_token: 'stale-token' } }),
			helpers: { refreshOAuth2Token },
		} as unknown as IExecuteFunctions;

		const auth = await resolveMcpAuth(context, 0);

		await expect(auth.refresh?.()).resolves.toBe('fresh-token');
		expect(refreshOAuth2Token).toHaveBeenCalledWith('haystackEnterpriseOAuth2Api');
	});

	it('resolves refresh to undefined (instead of throwing) when n8n cannot refresh the token', async () => {
		const context = {
			getNode: () => ({ name: 'Haystack Enterprise MCP' }),
			getNodeParameter: (name: string) => (name === 'authentication' ? 'oAuth2' : undefined),
			getCredentials: async () => ({ oauthTokenData: { access_token: 'stale-token' } }),
			helpers: {
				refreshOAuth2Token: async () => {
					throw new Error('No refresh token');
				},
			},
		} as unknown as IExecuteFunctions;

		const auth = await resolveMcpAuth(context, 0);

		await expect(auth.refresh?.()).resolves.toBeUndefined();
	});
});

describe('createBearerFetch', () => {
	it('sets the Authorization header on every request, preserving the other headers', async () => {
		const baseFetch = vi.fn(async () => okResponse());
		const fetchWithAuth = createBearerFetch(
			{ token: 'secret-key', apiOrigin: DEFAULT_API_ORIGIN },
			baseFetch,
		);

		await fetchWithAuth('https://example.test/mcp', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{}',
		});

		expect(baseFetch).toHaveBeenCalledTimes(1);
		const [, init] = baseFetch.mock.calls[0] as unknown as [string, RequestInit];
		const headers = new Headers(init.headers);
		expect(headers.get('authorization')).toBe('Bearer secret-key');
		expect(headers.get('content-type')).toBe('application/json');
		expect(init.method).toBe('POST');
		expect(init.body).toBe('{}');
	});

	it('returns a 401 as-is when the auth has no refresh (API key)', async () => {
		const baseFetch = vi.fn(async () => unauthorizedResponse());
		const fetchWithAuth = createBearerFetch(
			{ token: 'bad-key', apiOrigin: DEFAULT_API_ORIGIN },
			baseFetch,
		);

		const response = await fetchWithAuth('https://example.test/mcp');

		expect(response.status).toBe(401);
		expect(baseFetch).toHaveBeenCalledTimes(1);
	});

	it('retries once with the refreshed token after a 401, and keeps using it afterwards', async () => {
		const baseFetch = vi
			.fn(async () => okResponse())
			.mockImplementationOnce(async () => unauthorizedResponse());
		const refresh = vi.fn(async () => 'fresh-token');
		const fetchWithAuth = createBearerFetch(
			{ token: 'stale-token', apiOrigin: DEFAULT_API_ORIGIN, refresh },
			baseFetch,
		);

		const response = await fetchWithAuth('https://example.test/mcp');
		await fetchWithAuth('https://example.test/mcp');

		expect(response.status).toBe(200);
		expect(refresh).toHaveBeenCalledTimes(1);
		const sentTokens = baseFetch.mock.calls.map(([, init]: unknown[]) =>
			new Headers((init as RequestInit).headers).get('authorization'),
		);
		expect(sentTokens).toEqual(['Bearer stale-token', 'Bearer fresh-token', 'Bearer fresh-token']);
	});

	it('shares one rotating-token refresh across concurrent 401 responses', async () => {
		const baseFetch = vi
			.fn(async () => okResponse())
			.mockImplementationOnce(async () => unauthorizedResponse())
			.mockImplementationOnce(async () => unauthorizedResponse());
		const refresh = vi.fn(async () => 'fresh-token');
		const fetchWithAuth = createBearerFetch(
			{ token: 'stale-token', apiOrigin: DEFAULT_API_ORIGIN, refresh },
			baseFetch,
		);

		const responses = await Promise.all([
			fetchWithAuth('https://example.test/mcp'),
			fetchWithAuth('https://example.test/mcp'),
		]);

		expect(responses.map(({ status }) => status)).toEqual([200, 200]);
		expect(refresh).toHaveBeenCalledTimes(1);
		const sentTokens = baseFetch.mock.calls.map(([, init]: unknown[]) =>
			new Headers((init as RequestInit).headers).get('authorization'),
		);
		expect(sentTokens).toEqual([
			'Bearer stale-token',
			'Bearer stale-token',
			'Bearer fresh-token',
			'Bearer fresh-token',
		]);
	});

	it('surfaces the original 401 without retrying when the refresh fails', async () => {
		const baseFetch = vi.fn(async () => unauthorizedResponse());
		const fetchWithAuth = createBearerFetch(
			{ token: 'stale-token', apiOrigin: DEFAULT_API_ORIGIN, refresh: async () => undefined },
			baseFetch,
		);

		const response = await fetchWithAuth('https://example.test/mcp');

		expect(response.status).toBe(401);
		expect(baseFetch).toHaveBeenCalledTimes(1);
	});

	it('does not loop when the refreshed token is also rejected', async () => {
		const baseFetch = vi.fn(async () => unauthorizedResponse());
		const fetchWithAuth = createBearerFetch(
			{ token: 'stale-token', apiOrigin: DEFAULT_API_ORIGIN, refresh: async () => 'fresh-token' },
			baseFetch,
		);

		const response = await fetchWithAuth('https://example.test/mcp');

		expect(response.status).toBe(401);
		expect(baseFetch).toHaveBeenCalledTimes(2);
	});
});

describe('getApiBaseUrlV2FromOrigin', () => {
	it('appends /api/v2 to a bare origin', () => {
		expect(getApiBaseUrlV2FromOrigin('https://host.example.com')).toBe(
			'https://host.example.com/api/v2',
		);
	});

	it('removes trailing slashes before appending /api/v2', () => {
		expect(getApiBaseUrlV2FromOrigin('https://host.example.com/')).toBe(
			'https://host.example.com/api/v2',
		);
	});
});

describe('normalizeMcpInputSchema', () => {
	it('passes through a valid object schema unchanged', () => {
		const schema = { type: 'object', properties: { foo: { type: 'string' } } };
		expect(normalizeMcpInputSchema(schema)).toEqual(schema);
	});

	it('falls back to an empty object schema for non-object input', () => {
		expect(normalizeMcpInputSchema('None')).toEqual({ type: 'object', properties: {} });
		expect(normalizeMcpInputSchema(null)).toEqual({ type: 'object', properties: {} });
		expect(normalizeMcpInputSchema(undefined)).toEqual({ type: 'object', properties: {} });
		expect(normalizeMcpInputSchema([])).toEqual({ type: 'object', properties: {} });
	});

	it('forces type to object and defaults properties when missing', () => {
		expect(normalizeMcpInputSchema({ type: 'string' })).toEqual({ type: 'object', properties: {} });
	});

	it('keeps valid properties when forcing type to object', () => {
		expect(normalizeMcpInputSchema({ properties: { foo: { type: 'string' } } })).toEqual({
			type: 'object',
			properties: { foo: { type: 'string' } },
		});
	});

	it('defaults properties to {} when type is already "object" but properties is the Python "None" string', () => {
		expect(normalizeMcpInputSchema({ type: 'object', properties: 'None' })).toEqual({
			type: 'object',
			properties: {},
		});
	});
});

describe('buildMcpToolName', () => {
	it('joins the node name and tool name with an underscore', () => {
		expect(buildMcpToolName('MyNode', 'search')).toBe('MyNode_search');
	});

	it('sanitizes characters LLM providers reject from both the node name and tool name', () => {
		expect(buildMcpToolName('Haystack Enterprise MCP', 'Customer Support Bot!')).toBe(
			'Haystack_Enterprise_MCP_Customer_Support_Bot_',
		);
	});

	it('only ever returns characters LLM providers accept', () => {
		const name = buildMcpToolName('日本語 ワークスペース', '検索 パイプライン');
		expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
	});

	it('produces different names for the same tool exposed by two differently-named nodes', () => {
		const first = buildMcpToolName('Workspace A', 'search');
		const second = buildMcpToolName('Workspace B', 'search');
		expect(first).not.toBe(second);
	});

	it('truncates to 64 characters, preferring to drop from the node-name prefix', () => {
		const toolName = 'a'.repeat(40);
		const name = buildMcpToolName('a'.repeat(100), toolName);
		expect(name.length).toBeLessThanOrEqual(64);
		expect(name.endsWith(toolName)).toBe(true);
	});

	it('truncates the tool name itself when it alone already exceeds 64 characters', () => {
		const name = buildMcpToolName('Node', 'a'.repeat(100));
		expect(name.length).toBeLessThanOrEqual(64);
		expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
	});
});

describe('contentToString', () => {
	it('passes through a plain string', () => {
		expect(contentToString('hello')).toBe('hello');
	});

	it('joins text blocks from an array', () => {
		expect(
			contentToString([
				{ type: 'text', text: 'first' },
				{ type: 'text', text: 'second' },
			]),
		).toBe('first\nsecond');
	});

	it('serializes non-text blocks as JSON instead of dropping them', () => {
		expect(
			contentToString([
				{ type: 'text', text: 'kept' },
				{ type: 'image', data: 'ignored' },
			]),
		).toBe('kept\n{"type":"image","data":"ignored"}');
	});

	it('stringifies anything else', () => {
		expect(contentToString({ foo: 'bar' })).toBe('{"foo":"bar"}');
	});

	it('returns an empty string for undefined or null content', () => {
		expect(contentToString(undefined)).toBe('');
		expect(contentToString(null)).toBe('');
	});
});

describe('isStructuredContent', () => {
	it('accepts a plain object', () => {
		expect(isStructuredContent({ foo: 'bar' })).toBe(true);
	});

	it('rejects undefined, null, and arrays', () => {
		expect(isStructuredContent(undefined)).toBe(false);
		expect(isStructuredContent(null)).toBe(false);
		expect(isStructuredContent([{ foo: 'bar' }])).toBe(false);
	});
});

describe('loadWorkspaceOptions', () => {
	it('maps workspaces to name/value options using workspace_id as the value', async () => {
		const context = createLoadOptionsContext(async () => [
			{ name: 'wesley', workspace_id: '077da66c-c5f1-48f9-ab08-aed31f04cd8f' },
			{ name: 'default', workspace_id: 'b085a1db-1b15-4091-8051-a5354a428fd4' },
		]);

		expect(await loadWorkspaceOptions(context)).toEqual([
			{ name: 'Wesley', value: '077da66c-c5f1-48f9-ab08-aed31f04cd8f' },
			{ name: 'Default', value: 'b085a1db-1b15-4091-8051-a5354a428fd4' },
		]);
	});

	it('skips entries missing a name or workspace_id', () => {
		const context = createLoadOptionsContext(async () => [
			{ name: 'has-id', workspace_id: 'id-1' },
			{ name: 'missing-id' },
			{ workspace_id: 'missing-name' },
		]);

		return expect(loadWorkspaceOptions(context)).resolves.toEqual([
			{ name: 'Has-id', value: 'id-1' },
		]);
	});

	it('returns an empty list for a non-array response', async () => {
		const context = createLoadOptionsContext(async () => ({ foo: 'bar' }));
		expect(await loadWorkspaceOptions(context)).toEqual([]);
	});

	it('authenticates with the API key credential type by default', async () => {
		const httpRequestWithAuthentication = vi.fn(async () => []);
		await loadWorkspaceOptions(createLoadOptionsContext(httpRequestWithAuthentication));

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.anything(),
		);
	});

	it("authenticates with the OAuth2 credential type when the node's Authentication is OAuth2", async () => {
		const httpRequestWithAuthentication = vi.fn(async () => []);
		await loadWorkspaceOptions(
			createLoadOptionsContext(httpRequestWithAuthentication, { authentication: 'oAuth2' }),
		);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseOAuth2Api',
			expect.anything(),
		);
	});

	it('wraps request failures in a NodeOperationError', async () => {
		const context = createLoadOptionsContext(async () => {
			throw new Error('Invalid API key');
		});

		await expect(loadWorkspaceOptions(context)).rejects.toThrow();
	});

	// Authenticated requests wrap HTTP failures before callers receive them.
	function throwPreWrapped(node: { name: string }, rawError: Error) {
		throw new NodeApiError(node, rawError as unknown as Record<string, unknown>);
	}

	// Load-options errors must remain readable after crossing n8n's REST boundary.
	it('throws a NodeOperationError (not a NodeApiError) with a "list workspaces" permission hint on a 403', async () => {
		const node = { name: 'Haystack Enterprise MCP' };
		const context = {
			helpers: {
				httpRequestWithAuthentication: async () => {
					throwPreWrapped(
						node,
						Object.assign(new Error('Request failed with status code 403'), {
							response: { status: 403, data: { errors: ['Forbidden'] } },
						}),
					);
				},
			},
			getNode: () => node,
			getNodeParameter: (name: string) => (name === 'authentication' ? 'apiKey' : undefined),
			getCurrentNodeParameter: () => undefined,
			getCredentials: async () => ({ apiKey: 'secret-key' }),
		} as unknown as ILoadOptionsFunctions;

		const error = await loadWorkspaceOptions(context).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error).not.toBeInstanceOf(NodeApiError);
		expect((error as NodeOperationError).message).toMatch(
			/doesn't have permission to list workspaces.*workspace access and permission to list workspaces/s,
		);
	});

	it('replaces the message with a credential hint on a 401', async () => {
		const node = { name: 'Haystack Enterprise MCP' };
		const context = {
			helpers: {
				httpRequestWithAuthentication: async () => {
					throwPreWrapped(
						node,
						Object.assign(new Error('Request failed with status code 401'), {
							response: { status: 401, data: { errors: ['Unauthorized'] } },
						}),
					);
				},
			},
			getNode: () => node,
			getNodeParameter: (name: string) => (name === 'authentication' ? 'apiKey' : undefined),
			getCurrentNodeParameter: () => undefined,
			getCredentials: async () => ({ apiKey: 'secret-key' }),
		} as unknown as ILoadOptionsFunctions;

		await expect(loadWorkspaceOptions(context)).rejects.toMatchObject({
			message: expect.stringMatching(/API key.*valid/),
		});
	});

	it("never leaves .message as a non-string object when the HTTP status code can't be determined", async () => {
		const node = { name: 'Haystack Enterprise MCP' };
		const context = {
			helpers: {
				httpRequestWithAuthentication: async () => {
					throwPreWrapped(
						node,
						Object.assign(new Error('unused'), {
							message: { errors: ['Internal error'] } as unknown as string,
						}),
					);
				},
			},
			getNode: () => node,
			getNodeParameter: (name: string) => (name === 'authentication' ? 'apiKey' : undefined),
			getCurrentNodeParameter: () => undefined,
			getCredentials: async () => ({ apiKey: 'secret-key' }),
		} as unknown as ILoadOptionsFunctions;

		const error = await loadWorkspaceOptions(context).catch((caught: unknown) => caught);

		expect(typeof (error as { message: unknown }).message).toBe('string');
		expect((error as Error).message).not.toBe('[object Object]');
	});
});

describe('loadMcpToolOptions', () => {
	const context = {
		getNode: () => ({ name: 'Haystack Enterprise MCP' }),
		getCredentials: async () => ({ apiKey: 'secret-key' }),
	} as unknown as ILoadOptionsFunctions;

	beforeEach(() => {
		mockConnect.mockReset().mockResolvedValue(undefined);
		mockListTools.mockReset();
		mockClose.mockReset().mockResolvedValue(undefined);
		TransportMock.mockClear();
	});

	it('connects with a bearer token and maps tools to name/value options', async () => {
		mockListTools.mockResolvedValue({
			tools: [
				{ name: 'search', description: 'Search the knowledge base' },
				{ name: 'no-description' },
			],
		});

		const options = await loadMcpToolOptions(context, 'workspace-1', {
			token: 'secret-key',
			apiOrigin: DEFAULT_API_ORIGIN,
		});

		expect(options).toEqual([
			{ name: 'search', value: 'search', description: 'Search the knowledge base' },
			{ name: 'no-description', value: 'no-description', description: '' },
		]);
		// The fetch wrapper reads the current token after OAuth2 refreshes.
		expect(TransportMock).toHaveBeenCalledWith(
			new URL(`${getApiBaseUrlV2FromOrigin(DEFAULT_API_ORIGIN)}/workspaces/workspace-1/mcp`),
			expect.objectContaining({ fetch: expect.any(Function) }),
		);
		const transportOptions = TransportMock.mock.calls[0][1] as { fetch: typeof fetch };
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
		try {
			await transportOptions.fetch('https://example.test/mcp');
			const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
			expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret-key');
		} finally {
			fetchSpy.mockRestore();
		}
		expect(mockClose).toHaveBeenCalledTimes(1);
	});

	it("uses the Server URL from the credential (resolved into the auth's apiOrigin) for the MCP endpoint", async () => {
		mockListTools.mockResolvedValue({ tools: [{ name: 'search' }] });
		const customContext = {
			getNode: () => ({ name: 'Haystack Enterprise MCP' }),
			getNodeParameter: (name: string) => (name === 'authentication' ? 'apiKey' : undefined),
			getCurrentNodeParameter: () => undefined,
			getCredentials: async () => ({
				apiKey: 'secret-key',
				serverUrl: 'https://self-hosted.example.com',
			}),
		} as unknown as ILoadOptionsFunctions;

		const auth = await resolveMcpAuth(customContext, 0);
		await loadMcpToolOptions(customContext, 'workspace-1', auth);

		expect(auth.apiOrigin).toBe('https://self-hosted.example.com');
		expect(TransportMock).toHaveBeenCalledWith(
			new URL('https://self-hosted.example.com/api/v2/workspaces/workspace-1/mcp'),
			expect.objectContaining({ fetch: expect.any(Function) }),
		);
	});

	it('derives the MCP endpoint from the OAuth2 Server URL', async () => {
		mockListTools.mockResolvedValue({ tools: [{ name: 'search' }] });
		const customContext = {
			getNode: () => ({ name: 'Haystack Enterprise MCP' }),
			getNodeParameter: (name: string, fallback?: unknown) =>
				name === 'authentication' ? 'oAuth2' : fallback,
			getCurrentNodeParameter: () => undefined,
			getCredentials: async () => ({
				serverUrl: 'https://self-hosted.example.com',
				oauthTokenData: { access_token: 'oauth-token' },
			}),
		} as unknown as ILoadOptionsFunctions;

		const auth = await resolveMcpAuth(customContext, 0);
		await loadMcpToolOptions(customContext, 'workspace-1', auth);

		expect(TransportMock).toHaveBeenCalledWith(
			new URL('https://self-hosted.example.com/api/v2/workspaces/workspace-1/mcp'),
			expect.objectContaining({ fetch: expect.any(Function) }),
		);
	});

	it('follows nextCursor to collect tools across multiple pages', async () => {
		mockListTools
			.mockResolvedValueOnce({ tools: [{ name: 'page-1-tool' }], nextCursor: 'cursor-2' })
			.mockResolvedValueOnce({ tools: [{ name: 'page-2-tool' }] });

		const options = await loadMcpToolOptions(context, 'workspace-1', {
			token: 'secret-key',
			apiOrigin: DEFAULT_API_ORIGIN,
		});

		expect(options.map((o) => o.name)).toEqual(['page-1-tool', 'page-2-tool']);
		expect(mockListTools).toHaveBeenNthCalledWith(1, undefined, undefined);
		expect(mockListTools).toHaveBeenNthCalledWith(2, { cursor: 'cursor-2' }, undefined);
	});

	it('still closes the client if listing tools fails, surfacing the original error message unwrapped', async () => {
		mockListTools.mockRejectedValue(new Error('boom'));

		await expect(
			loadMcpToolOptions(context, 'workspace-1', {
				token: 'secret-key',
				apiOrigin: DEFAULT_API_ORIGIN,
			}),
		).rejects.toThrow('boom');
		expect(mockClose).toHaveBeenCalledTimes(1);
	});

	it('surfaces an unclassified connection failure as-is, without a synthesized fallback message', async () => {
		mockConnect.mockRejectedValue(new Error('connection refused'));

		await expect(
			loadMcpToolOptions(context, 'workspace-1', {
				token: 'secret-key',
				apiOrigin: DEFAULT_API_ORIGIN,
			}),
		).rejects.toThrow('connection refused');
	});

	it('surfaces a 404 as-is — only 401/403 get a synthesized hint', async () => {
		mockConnect.mockRejectedValue(new StreamableHTTPError(404, 'Not Found'));

		await expect(
			loadMcpToolOptions(context, 'workspace-1', {
				token: 'secret-key',
				apiOrigin: DEFAULT_API_ORIGIN,
			}),
		).rejects.toThrow('Streamable HTTP error: Not Found');
	});

	it('adds a workspace-access hint when connecting fails with a 403', async () => {
		mockConnect.mockRejectedValue(new StreamableHTTPError(403, 'Forbidden'));

		await expect(
			loadMcpToolOptions(context, 'workspace-1', {
				token: 'secret-key',
				apiOrigin: DEFAULT_API_ORIGIN,
			}),
		).rejects.toThrow(/doesn't have access to this workspace.*org-wide one/s);
	});

	it('adds a credential hint when connecting fails with a 401', async () => {
		mockConnect.mockRejectedValue(new StreamableHTTPError(401, 'Unauthorized'));

		await expect(
			loadMcpToolOptions(context, 'workspace-1', {
				token: 'secret-key',
				apiOrigin: DEFAULT_API_ORIGIN,
			}),
		).rejects.toThrow(/API key.*valid/);
	});
});

describe('listAllMcpTools', () => {
	it('returns tools from a single page unchanged', async () => {
		const client = {
			listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'a' }, { name: 'b' }] }),
		};

		const tools = await listAllMcpTools(client as never);

		expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
		expect(client.listTools).toHaveBeenCalledTimes(1);
	});

	it('stops once a page has no nextCursor', async () => {
		const client = {
			listTools: vi
				.fn()
				.mockResolvedValueOnce({ tools: [{ name: 'a' }], nextCursor: 'c1' })
				.mockResolvedValueOnce({ tools: [{ name: 'b' }], nextCursor: 'c2' })
				.mockResolvedValueOnce({ tools: [{ name: 'c' }] }),
		};

		const tools = await listAllMcpTools(client as never);

		expect(tools.map((t) => t.name)).toEqual(['a', 'b', 'c']);
		expect(client.listTools).toHaveBeenCalledTimes(3);
		expect(client.listTools).toHaveBeenNthCalledWith(2, { cursor: 'c1' }, undefined);
		expect(client.listTools).toHaveBeenNthCalledWith(3, { cursor: 'c2' }, undefined);
	});

	it('forwards request options (e.g. signal) to every page', async () => {
		const client = { listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'a' }] }) };
		const controller = new AbortController();

		await listAllMcpTools(client as never, { signal: controller.signal });

		expect(client.listTools).toHaveBeenCalledWith(undefined, { signal: controller.signal });
	});
});

describe('describeTransportErrorHint', () => {
	it('returns a credential hint for a 401 StreamableHTTPError', () => {
		expect(describeTransportErrorHint(new StreamableHTTPError(401, 'Unauthorized'))).toMatch(
			/API key.*valid/,
		);
	});

	it('returns a workspace-access hint for a 403 StreamableHTTPError', () => {
		expect(describeTransportErrorHint(new StreamableHTTPError(403, 'Forbidden'))).toMatch(
			/doesn't have access to this workspace.*org-wide one/,
		);
	});

	it('returns an empty string for a StreamableHTTPError with any other status', () => {
		expect(describeTransportErrorHint(new StreamableHTTPError(404, 'Not Found'))).toBe('');
		expect(describeTransportErrorHint(new StreamableHTTPError(500, 'Internal Server Error'))).toBe(
			'',
		);
	});

	it('returns an empty string for a non-StreamableHTTPError, so callers surface it as-is', () => {
		expect(describeTransportErrorHint(new Error('connection refused'))).toBe('');
		expect(describeTransportErrorHint('a plain string')).toBe('');
		expect(describeTransportErrorHint(undefined)).toBe('');
	});
});

describe('describeToolCallErrorHint', () => {
	it('explains an InvalidParams McpError as the agent likely needing to retry', () => {
		expect(describeToolCallErrorHint(new McpError(ErrorCode.InvalidParams, 'bad input'))).toMatch(
			/didn't match this tool's expected parameters/,
		);
	});

	it('explains a MethodNotFound McpError as the tool having disappeared', () => {
		expect(
			describeToolCallErrorHint(new McpError(ErrorCode.MethodNotFound, 'no such tool')),
		).toMatch(/no longer available on the MCP server/);
	});

	it('explains an InternalError McpError as a pipeline failure', () => {
		expect(describeToolCallErrorHint(new McpError(ErrorCode.InternalError, 'boom'))).toMatch(
			/underlying Haystack Enterprise Platform pipeline failed/,
		);
	});

	it('returns an empty string for an McpError code it does not classify', () => {
		expect(describeToolCallErrorHint(new McpError(ErrorCode.ParseError, 'bad json'))).toBe('');
	});

	it('returns an empty string for a non-McpError, so callers surface it as-is', () => {
		expect(describeToolCallErrorHint(new Error('network error'))).toBe('');
		expect(describeToolCallErrorHint(undefined)).toBe('');
	});
});

describe('getSelectedTools', () => {
	const tools = [{ name: 'search' }, { name: 'chat' }, { name: 'index' }];

	it('returns every tool when mode is "all", regardless of include/exclude lists', () => {
		expect(
			getSelectedTools({ mode: 'all', includeTools: ['search'], excludeTools: ['chat'], tools }),
		).toEqual(tools);
	});

	it('returns only the named tools when mode is "selected"', () => {
		expect(
			getSelectedTools({ mode: 'selected', includeTools: ['chat'], excludeTools: [], tools }),
		).toEqual([{ name: 'chat' }]);
	});

	it('falls back to every tool when mode is "selected" but no tools were chosen yet', () => {
		expect(
			getSelectedTools({ mode: 'selected', includeTools: [], excludeTools: [], tools }),
		).toEqual(tools);
	});

	it('ignores selected names that no longer exist on the server', () => {
		expect(
			getSelectedTools({
				mode: 'selected',
				includeTools: ['chat', 'removed-tool'],
				excludeTools: [],
				tools,
			}),
		).toEqual([{ name: 'chat' }]);
	});

	it('excludes the named tools when mode is "except"', () => {
		expect(
			getSelectedTools({ mode: 'except', includeTools: [], excludeTools: ['chat'], tools }),
		).toEqual([{ name: 'search' }, { name: 'index' }]);
	});

	it('returns every tool when mode is "except" but nothing is excluded', () => {
		expect(getSelectedTools({ mode: 'except', includeTools: [], excludeTools: [], tools })).toEqual(
			tools,
		);
	});

	it('can exclude every tool, returning an empty list', () => {
		expect(
			getSelectedTools({
				mode: 'except',
				includeTools: [],
				excludeTools: ['search', 'chat', 'index'],
				tools,
			}),
		).toEqual([]);
	});
});
