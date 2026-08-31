import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
	API_BASE_URL_V2,
	buildMcpToolName,
	contentToString,
	describeToolCallErrorHint,
	describeTransportErrorHint,
	getSelectedTools,
	isStructuredContent,
	listAllMcpTools,
	loadMcpToolOptions,
	loadWorkspaceOptions,
	normalizeMcpInputSchema,
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
	const actual = await importOriginal<typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')>();
	return { ...actual, StreamableHTTPClientTransport: TransportMock };
});

function createLoadOptionsContext(httpRequestWithAuthentication: (...args: unknown[]) => unknown) {
	return {
		helpers: { httpRequestWithAuthentication },
		getNode: () => ({ name: 'Haystack Enterprise MCP' }),
		// Only 'authentication' (read by getAuthenticationMode()) is ever looked up on this
		// fake — always falls back to the default 'apiKey', same as real n8n does for an unset
		// parameter.
		getNodeParameter: (_name: string, _itemIndex: number, fallback?: unknown) => fallback,
	} as unknown as ILoadOptionsFunctions;
}

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

		return expect(loadWorkspaceOptions(context)).resolves.toEqual([{ name: 'Has-id', value: 'id-1' }]);
	});

	it('returns an empty list for a non-array response', async () => {
		const context = createLoadOptionsContext(async () => ({ foo: 'bar' }));
		expect(await loadWorkspaceOptions(context)).toEqual([]);
	});

	it('wraps request failures in a NodeOperationError', async () => {
		const context = createLoadOptionsContext(async () => {
			throw new Error('Invalid API key');
		});

		await expect(loadWorkspaceOptions(context)).rejects.toThrow();
	});

	// httpRequestWithAuthentication() already wraps HTTP failures in its own
	// NodeApiError before loadWorkspaceOptions ever sees them (see the
	// docstring in utils.ts), so tests reproduce that shape directly rather
	// than throwing a plain Error.
	function throwPreWrapped(node: { name: string }, rawError: Error) {
		throw new NodeApiError(node, rawError as unknown as Record<string, unknown>);
	}

	// n8n's own REST client special-cases any error whose serialized `.name`
	// is exactly "NodeApiError": instead of reconstructing a proper `Error`
	// instance client-side (like it does for every other error shape), it
	// re-throws the raw parsed JSON body as-is. The "problem loading the
	// parameter options" popover only knows how to read `.message` off a
	// real `instanceof Error`, so a NodeApiError here renders as the
	// literal, useless text "[object Object]" no matter how good `.message`
	// is — so loadWorkspaceOptions must throw a NodeOperationError instead.
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
			getNodeParameter: (_name: string, _itemIndex: number, fallback?: unknown) => fallback,
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
			getNodeParameter: (_name: string, _itemIndex: number, fallback?: unknown) => fallback,
		} as unknown as ILoadOptionsFunctions;

		await expect(loadWorkspaceOptions(context)).rejects.toMatchObject({
			message: expect.stringMatching(/API key.*valid/),
		});
	});

	// Regression test for the reported bug: hitting a 403 while listing
	// workspaces showed the literal text `[object Object]` in n8n's "problem
	// loading the parameter options" popover. That popover renders `.message`
	// directly, and when NodeApiError can't determine an HTTP status code at
	// all, an earlier internal assignment (`this.message = errorResponse.message`)
	// can leave `.message` as a raw, non-string object instead of coercing it
	// to a string.
	it('never leaves .message as a non-string object when the HTTP status code can\'t be determined', async () => {
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
			getNodeParameter: (_name: string, _itemIndex: number, fallback?: unknown) => fallback,
		} as unknown as ILoadOptionsFunctions;

		const error = await loadWorkspaceOptions(context).catch((caught: unknown) => caught);

		expect(typeof (error as { message: unknown }).message).toBe('string');
		expect((error as Error).message).not.toBe('[object Object]');
	});
});

describe('loadMcpToolOptions', () => {
	const context = { getNode: () => ({ name: 'Haystack Enterprise MCP' }) } as unknown as ILoadOptionsFunctions;

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

		const options = await loadMcpToolOptions(context, 'workspace-1', 'secret-key');

		expect(options).toEqual([
			{ name: 'search', value: 'search', description: 'Search the knowledge base' },
			{ name: 'no-description', value: 'no-description', description: '' },
		]);
		expect(TransportMock).toHaveBeenCalledWith(
			new URL(`${API_BASE_URL_V2}/workspaces/workspace-1/mcp`),
			expect.objectContaining({ requestInit: { headers: { Authorization: 'Bearer secret-key' } } }),
		);
		expect(mockClose).toHaveBeenCalledTimes(1);
	});

	it('follows nextCursor to collect tools across multiple pages', async () => {
		mockListTools
			.mockResolvedValueOnce({ tools: [{ name: 'page-1-tool' }], nextCursor: 'cursor-2' })
			.mockResolvedValueOnce({ tools: [{ name: 'page-2-tool' }] });

		const options = await loadMcpToolOptions(context, 'workspace-1', 'secret-key');

		expect(options.map((o) => o.name)).toEqual(['page-1-tool', 'page-2-tool']);
		expect(mockListTools).toHaveBeenNthCalledWith(1, undefined, undefined);
		expect(mockListTools).toHaveBeenNthCalledWith(2, { cursor: 'cursor-2' }, undefined);
	});

	it('still closes the client if listing tools fails, surfacing the original error message unwrapped', async () => {
		mockListTools.mockRejectedValue(new Error('boom'));

		await expect(loadMcpToolOptions(context, 'workspace-1', 'secret-key')).rejects.toThrow('boom');
		expect(mockClose).toHaveBeenCalledTimes(1);
	});

	it('surfaces an unclassified connection failure as-is, without a synthesized fallback message', async () => {
		mockConnect.mockRejectedValue(new Error('connection refused'));

		await expect(loadMcpToolOptions(context, 'workspace-1', 'secret-key')).rejects.toThrow('connection refused');
	});

	it('surfaces a 404 as-is — only 401/403 get a synthesized hint', async () => {
		mockConnect.mockRejectedValue(new StreamableHTTPError(404, 'Not Found'));

		await expect(loadMcpToolOptions(context, 'workspace-1', 'secret-key')).rejects.toThrow(
			'Streamable HTTP error: Not Found',
		);
	});

	it('adds a workspace-access hint when connecting fails with a 403', async () => {
		mockConnect.mockRejectedValue(new StreamableHTTPError(403, 'Forbidden'));

		await expect(loadMcpToolOptions(context, 'workspace-1', 'secret-key')).rejects.toThrow(
			/doesn't have access to this workspace.*org-wide one/s,
		);
	});

	it('adds a credential hint when connecting fails with a 401', async () => {
		mockConnect.mockRejectedValue(new StreamableHTTPError(401, 'Unauthorized'));

		await expect(loadMcpToolOptions(context, 'workspace-1', 'secret-key')).rejects.toThrow(/API key.*valid/);
	});
});

describe('listAllMcpTools', () => {
	it('returns tools from a single page unchanged', async () => {
		const client = { listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'a' }, { name: 'b' }] }) };

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
		expect(describeTransportErrorHint(new StreamableHTTPError(401, 'Unauthorized'))).toMatch(/API key.*valid/);
	});

	it('returns a workspace-access hint for a 403 StreamableHTTPError', () => {
		expect(describeTransportErrorHint(new StreamableHTTPError(403, 'Forbidden'))).toMatch(
			/doesn't have access to this workspace.*org-wide one/,
		);
	});

	it('returns an empty string for a StreamableHTTPError with any other status', () => {
		expect(describeTransportErrorHint(new StreamableHTTPError(404, 'Not Found'))).toBe('');
		expect(describeTransportErrorHint(new StreamableHTTPError(500, 'Internal Server Error'))).toBe('');
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
		expect(describeToolCallErrorHint(new McpError(ErrorCode.MethodNotFound, 'no such tool'))).toMatch(
			/no longer available on the MCP server/,
		);
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
		expect(getSelectedTools({ mode: 'all', includeTools: ['search'], excludeTools: ['chat'], tools })).toEqual(
			tools,
		);
	});

	it('returns only the named tools when mode is "selected"', () => {
		expect(getSelectedTools({ mode: 'selected', includeTools: ['chat'], excludeTools: [], tools })).toEqual([
			{ name: 'chat' },
		]);
	});

	it('falls back to every tool when mode is "selected" but no tools were chosen yet', () => {
		expect(getSelectedTools({ mode: 'selected', includeTools: [], excludeTools: [], tools })).toEqual(tools);
	});

	it('ignores selected names that no longer exist on the server', () => {
		expect(
			getSelectedTools({ mode: 'selected', includeTools: ['chat', 'removed-tool'], excludeTools: [], tools }),
		).toEqual([{ name: 'chat' }]);
	});

	it('excludes the named tools when mode is "except"', () => {
		expect(getSelectedTools({ mode: 'except', includeTools: [], excludeTools: ['chat'], tools })).toEqual([
			{ name: 'search' },
			{ name: 'index' },
		]);
	});

	it('returns every tool when mode is "except" but nothing is excluded', () => {
		expect(getSelectedTools({ mode: 'except', includeTools: [], excludeTools: [], tools })).toEqual(tools);
	});

	it('can exclude every tool, returning an empty list', () => {
		expect(
			getSelectedTools({ mode: 'except', includeTools: [], excludeTools: ['search', 'chat', 'index'], tools }),
		).toEqual([]);
	});
});
