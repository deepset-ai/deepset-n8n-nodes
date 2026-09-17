import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions, ILoadOptionsFunctions, ISupplyDataFunctions } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { HaystackEnterpriseMcp } from '../../nodes/HaystackEnterpriseMcp/HaystackEnterpriseMcp.node';
import { buildMcpToolName } from '../../nodes/HaystackEnterpriseMcp/utils';

const NODE_NAME = 'Haystack Enterprise MCP';

const { mockConnect, mockListTools, mockCallTool, mockClose, ClientMock, TransportMock } =
	vi.hoisted(() => {
		const mockConnect = vi.fn();
		const mockListTools = vi.fn();
		const mockCallTool = vi.fn();
		const mockClose = vi.fn();
		const ClientMock = vi.fn().mockImplementation(() => ({
			connect: mockConnect,
			listTools: mockListTools,
			callTool: mockCallTool,
			close: mockClose,
		}));
		const TransportMock = vi.fn();
		return { mockConnect, mockListTools, mockCallTool, mockClose, ClientMock, TransportMock };
	});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: ClientMock }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')>();
	return { ...actual, StreamableHTTPClientTransport: TransportMock };
});
// n8n-core is a peer dependency resolved against n8n's own install at runtime
// (see HaystackEnterpriseMcp.node.ts) and isn't installed locally, so it's
// mocked here with the same trivial wrapper the real StructuredToolkit is.
vi.mock('n8n-core', () => ({
	StructuredToolkit: class {
		tools: unknown[];
		constructor(tools: unknown[]) {
			this.tools = tools;
		}
		getTools() {
			return this.tools;
		}
	},
}));

function createSupplyDataContext(
	params: Record<string, unknown>,
	credentials: Record<string, unknown> = { apiKey: 'secret-key' },
	signal?: AbortSignal,
) {
	return {
		getNode: () => ({ name: NODE_NAME }),
		getCredentials: async () => credentials,
		getNodeParameter: vi.fn((name: string, _itemIndex: number, fallback?: unknown) =>
			Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback,
		),
		getExecutionCancelSignal: () => signal,
		addInputData: vi.fn().mockReturnValue({ index: 0 }),
		addOutputData: vi.fn(),
		logAiEvent: vi.fn(),
		addExecutionHints: vi.fn(),
	} as unknown as ISupplyDataFunctions;
}

function createExecuteContext(
	items: Array<Record<string, unknown>>,
	params: Record<string, unknown>,
	options: {
		credentials?: Record<string, unknown>;
		signal?: AbortSignal;
		continueOnFail?: boolean;
	} = {},
) {
	const { credentials = { apiKey: 'secret-key' }, signal, continueOnFail = false } = options;
	return {
		getNode: () => ({ name: NODE_NAME }),
		getCredentials: async () => credentials,
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback,
		getExecutionCancelSignal: () => signal,
		getInputData: () => items.map((json) => ({ json })),
		continueOnFail: () => continueOnFail,
	} as unknown as IExecuteFunctions;
}

function createLoadOptionsContext(
	params: Record<string, unknown>,
	credentials: Record<string, unknown> = { apiKey: 'secret-key' },
	httpRequestWithAuthentication?: (...args: unknown[]) => unknown,
) {
	return {
		getNode: () => ({ name: NODE_NAME }),
		getCredentials: async () => credentials,
		getNodeParameter: vi.fn((name: string) => params[name]),
		helpers: { httpRequestWithAuthentication },
	} as unknown as ILoadOptionsFunctions;
}

describe('HaystackEnterpriseMcp', () => {
	const node = new HaystackEnterpriseMcp();
	const originalDeploymentType = process.env.N8N_DEPLOYMENT_TYPE;

	beforeEach(() => {
		delete process.env.N8N_DEPLOYMENT_TYPE;
		mockConnect.mockReset().mockResolvedValue(undefined);
		mockListTools.mockReset();
		mockCallTool.mockReset();
		mockClose.mockReset().mockResolvedValue(undefined);
		TransportMock.mockClear();
	});

	afterEach(() => {
		if (originalDeploymentType === undefined) {
			delete process.env.N8N_DEPLOYMENT_TYPE;
		} else {
			process.env.N8N_DEPLOYMENT_TYPE = originalDeploymentType;
		}
	});

	describe('supplyData', () => {
		it('refuses to run on n8n Cloud', async () => {
			process.env.N8N_DEPLOYMENT_TYPE = 'cloud';
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			await expect(node.supplyData.call(context, 0)).rejects.toThrow(/self-hosted/);
			expect(mockConnect).not.toHaveBeenCalled();
		});

		it('requires a workspace and an API key', async () => {
			const context = createSupplyDataContext({ workspaceId: '' });

			await expect(node.supplyData.call(context, 0)).rejects.toThrow(/workspace and an API key/);
		});

		it('refuses to run if the execution was already cancelled', async () => {
			const controller = new AbortController();
			controller.abort();
			const context = createSupplyDataContext(
				{ workspaceId: 'ws-1' },
				undefined,
				controller.signal,
			);

			await expect(node.supplyData.call(context, 0)).rejects.toThrow(/cancelled/);
			expect(mockConnect).not.toHaveBeenCalled();
		});

		it('passes the execution cancel signal to the transport and to listTools', async () => {
			const controller = new AbortController();
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			const context = createSupplyDataContext(
				{ workspaceId: 'ws-1' },
				undefined,
				controller.signal,
			);

			await node.supplyData.call(context, 0);

			expect(TransportMock).toHaveBeenCalledWith(
				expect.any(URL),
				expect.objectContaining({
					requestInit: expect.objectContaining({ signal: controller.signal }),
				}),
			);
			expect(mockListTools).toHaveBeenCalledWith(undefined, { signal: controller.signal });
		});

		it('wraps a connection failure with the MCP URL', async () => {
			// A plain "connection refused" message matches one of n8n's built-in
			// COMMON_ERRORS patterns, so NodeOperationError replaces `.message` with
			// its own friendlier text and moves our detailed message into `.messages`
			// instead (see n8n-workflow's NodeError.setDescriptiveErrorMessage) — so
			// assert against `.messages`, not `.message`.
			mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const error = await node.supplyData.call(context, 0).catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(NodeOperationError);
			expect((error as NodeOperationError).messages.join(' ')).toMatch(
				/Failed to connect.*ws-1.*ECONNREFUSED/s,
			);
		});

		it('adds a credential hint when connecting fails with a 401', async () => {
			mockConnect.mockRejectedValue(new StreamableHTTPError(401, 'Unauthorized'));
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const error = await node.supplyData.call(context, 0).catch((caught: unknown) => caught);

			expect((error as NodeOperationError).message).toMatch(/API key.*valid/);
		});

		it('surfaces a 404 as the plain wrapped SDK message — only 401/403 get a synthesized hint', async () => {
			mockConnect.mockRejectedValue(new StreamableHTTPError(404, 'Not Found'));
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const error = await node.supplyData.call(context, 0).catch((caught: unknown) => caught);

			expect((error as NodeOperationError).message).toMatch(/Failed to connect.*ws-1.*Not Found/s);
		});

		it('adds a workspace-access hint when connecting fails with a 403', async () => {
			mockConnect.mockRejectedValue(new StreamableHTTPError(403, 'Forbidden'));
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const error = await node.supplyData.call(context, 0).catch((caught: unknown) => caught);

			expect((error as NodeOperationError).message).toMatch(
				/doesn't have access to this workspace.*org-wide key/s,
			);
		});

		it('wraps a listTools failure and still closes the client', async () => {
			mockListTools.mockRejectedValue(new Error('boom'));
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			await expect(node.supplyData.call(context, 0)).rejects.toThrow(/Failed to list tools.*boom/s);
			expect(mockClose).toHaveBeenCalledTimes(1);
		});

		it('throws and closes the client when no tools are enabled on the server', async () => {
			mockListTools.mockResolvedValue({ tools: [] });
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			await expect(node.supplyData.call(context, 0)).rejects.toThrow(/No MCP tools found/);
			expect(mockClose).toHaveBeenCalledTimes(1);
		});

		it('exposes all tools when "include" mode is "all" (the default)', async () => {
			mockListTools.mockResolvedValue({
				tools: [
					{
						name: 'search',
						description: 'Search',
						inputSchema: { type: 'object', properties: {} },
					},
					{ name: 'chat', description: 'Chat', inputSchema: { type: 'object', properties: {} } },
				],
			});
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);

			expect(response.getTools()).toHaveLength(2);
			expect(response.getTools().map((tool: { name: string }) => tool.name)).toEqual([
				buildMcpToolName(NODE_NAME, 'search'),
				buildMcpToolName(NODE_NAME, 'chat'),
			]);
		});

		it('sanitizes free-text pipeline names into valid, node-namespaced tool names', async () => {
			mockListTools.mockResolvedValue({
				tools: [{ name: 'Customer Support Bot!', inputSchema: {} }],
			});
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);

			expect((response.getTools()[0] as { name: string }).name).toBe(
				'Haystack_Enterprise_MCP_Customer_Support_Bot_',
			);
			expect((response.getTools()[0] as { name: string }).name).toMatch(/^[a-zA-Z0-9_-]+$/);
		});

		it('still calls the real MCP tool name even though the exposed tool name is sanitized', async () => {
			mockListTools.mockResolvedValue({
				tools: [{ name: 'Customer Support Bot!', inputSchema: {} }],
			});
			mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);
			await (
				response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
			).func({});

			expect(mockCallTool).toHaveBeenCalledWith(
				{ name: 'Customer Support Bot!', arguments: {} },
				undefined,
				expect.anything(),
			);
		});

		it('restricts to the selected tools when "include" mode is "selected"', async () => {
			mockListTools.mockResolvedValue({
				tools: [
					{ name: 'search', inputSchema: {} },
					{ name: 'chat', inputSchema: {} },
				],
			});
			const context = createSupplyDataContext({
				workspaceId: 'ws-1',
				include: 'selected',
				includeTools: ['chat'],
			});

			const { response } = await node.supplyData.call(context, 0);

			expect(response.getTools().map((tool: { name: string }) => tool.name)).toEqual([
				buildMcpToolName(NODE_NAME, 'chat'),
			]);
		});

		it('excludes the listed tools when "include" mode is "except"', async () => {
			mockListTools.mockResolvedValue({
				tools: [
					{ name: 'search', inputSchema: {} },
					{ name: 'chat', inputSchema: {} },
				],
			});
			const context = createSupplyDataContext({
				workspaceId: 'ws-1',
				include: 'except',
				excludeTools: ['chat'],
			});

			const { response } = await node.supplyData.call(context, 0);

			expect(response.getTools().map((tool: { name: string }) => tool.name)).toEqual([
				buildMcpToolName(NODE_NAME, 'search'),
			]);
		});

		it('throws when none of the selected tools are available and closes the client', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			const context = createSupplyDataContext({
				workspaceId: 'ws-1',
				include: 'selected',
				includeTools: ['does-not-exist'],
			});

			await expect(node.supplyData.call(context, 0)).rejects.toThrow(/None of the selected tools/);
			expect(mockClose).toHaveBeenCalledTimes(1);
		});

		it('throws when "except" mode excludes every available tool and closes the client', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			const context = createSupplyDataContext({
				workspaceId: 'ws-1',
				include: 'except',
				excludeTools: ['search'],
			});

			await expect(node.supplyData.call(context, 0)).rejects.toThrow(
				/All available tools were excluded/,
			);
			expect(mockClose).toHaveBeenCalledTimes(1);
		});

		it('builds a tool whose schema is the normalized JSON Schema, not the placeholder', async () => {
			mockListTools.mockResolvedValue({
				tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'string' } }],
			});
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);

			expect((response.getTools()[0] as { schema: unknown }).schema).toEqual({
				type: 'object',
				properties: {},
			});
		});

		it("calls the tool's func by invoking client.callTool and returns the stringified content", async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'the answer' }] });
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);
			const result = await (
				response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
			).func({
				query: 'hello',
			});

			expect(mockCallTool).toHaveBeenCalledWith(
				{ name: 'search', arguments: { query: 'hello' } },
				undefined,
				{ timeout: 60000, signal: undefined },
			);
			expect(result).toBe('the answer');
		});

		it('uses a custom timeout and the execution cancel signal for the tool call', async () => {
			const controller = new AbortController();
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'the answer' }] });
			const context = createSupplyDataContext(
				{ workspaceId: 'ws-1', 'options.timeout': 5000 },
				undefined,
				controller.signal,
			);

			const { response } = await node.supplyData.call(context, 0);
			await (
				response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
			).func({});

			expect(mockCallTool).toHaveBeenCalledWith(expect.anything(), undefined, {
				timeout: 5000,
				signal: controller.signal,
			});
		});

		it('appends structuredContent to the output instead of dropping it', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({
				content: [{ type: 'text', text: 'the answer' }],
				structuredContent: { citations: ['doc-1'] },
			});
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);
			const result = await (
				response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
			).func({});

			expect(result).toBe('the answer\n{"citations":["doc-1"]}');
		});

		it('uses structuredContent as the output when there is no text content', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({ content: [], structuredContent: { citations: ['doc-1'] } });
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);
			const result = await (
				response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
			).func({});

			expect(result).toBe('{"citations":["doc-1"]}');
		});

		it('traces a successful call via addInputData/addOutputData and logAiEvent', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'the answer' }] });
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);
			await (
				response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
			).func({
				query: 'hello',
			});

			expect(context.addInputData).toHaveBeenCalledWith(NodeConnectionTypes.AiTool, [
				[{ json: { tool: 'search', input: { query: 'hello' } } }],
			]);
			expect(context.addOutputData).toHaveBeenCalledWith(NodeConnectionTypes.AiTool, 0, [
				[{ json: { tool: 'search', response: 'the answer' } }],
			]);
			expect(context.logAiEvent).toHaveBeenCalledWith(
				'ai-tool-called',
				expect.stringContaining('search'),
			);
		});

		it("wraps a tool call failure with the tool's name and traces it via addOutputData", async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockRejectedValue(new Error('pipeline error'));
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);

			await expect(
				(
					response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
				).func({}),
			).rejects.toThrow(/Haystack Enterprise Platform tool "search" failed: pipeline error/);
			expect(context.addOutputData).toHaveBeenCalledWith(
				NodeConnectionTypes.AiTool,
				0,
				expect.any(NodeOperationError),
			);
			expect(context.logAiEvent).not.toHaveBeenCalled();
		});

		it('treats a result with isError as a failure even though callTool did not throw', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({
				isError: true,
				content: [{ type: 'text', text: 'the pipeline crashed' }],
			});
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);

			await expect(
				(
					response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
				).func({}),
			).rejects.toThrow(/Haystack Enterprise Platform tool "search" failed: the pipeline crashed/);
			expect(context.addOutputData).toHaveBeenCalledWith(
				NodeConnectionTypes.AiTool,
				0,
				expect.any(NodeOperationError),
			);
			expect(context.logAiEvent).not.toHaveBeenCalled();
		});

		it('falls back to a generic message when isError is set with no content', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({ isError: true, content: [] });
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);

			await expect(
				(
					response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
				).func({}),
			).rejects.toThrow(/reported an error with no message/);
		});

		it('adds a self-correction hint when a tool call fails with InvalidParams', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockRejectedValue(
				new McpError(ErrorCode.InvalidParams, "'sender' is a required property"),
			);
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);

			await expect(
				(
					response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
				).func({}),
			).rejects.toThrow(/didn't match this tool's expected parameters/);
		});

		it('adds a refresh hint when a tool call fails with MethodNotFound', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockRejectedValue(new McpError(ErrorCode.MethodNotFound, 'Unknown tool'));
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);

			await expect(
				(
					response.getTools()[0] as { func: (input: Record<string, unknown>) => Promise<string> }
				).func({}),
			).rejects.toThrow(/refresh the "Tools to Include"\/"Tools to Exclude" list/);
		});

		it('warns when a selected tool is no longer available on the server', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			const context = createSupplyDataContext({
				workspaceId: 'ws-1',
				include: 'selected',
				includeTools: ['search', 'gone'],
			});

			await node.supplyData.call(context, 0);

			expect(context.addExecutionHints).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'warning', message: expect.stringContaining('gone') }),
			);
		});

		it('does not warn when every selected tool is still available', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			const context = createSupplyDataContext({
				workspaceId: 'ws-1',
				include: 'selected',
				includeTools: ['search'],
			});

			await node.supplyData.call(context, 0);

			expect(context.addExecutionHints).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: 'warning' }),
			);
		});

		it('flags tools that are missing a description', async () => {
			mockListTools.mockResolvedValue({
				tools: [
					{ name: 'search', description: 'Search the knowledge base', inputSchema: {} },
					{ name: 'chat', inputSchema: {} },
				],
			});
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			await node.supplyData.call(context, 0);

			expect(context.addExecutionHints).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'info', message: expect.stringContaining('chat') }),
			);
		});

		it('returns a closeFunction that closes the MCP client', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { closeFunction } = await node.supplyData.call(context, 0);
			expect(mockClose).not.toHaveBeenCalled();

			await closeFunction?.();

			expect(mockClose).toHaveBeenCalledTimes(1);
		});

		it('follows nextCursor to expose tools from every page', async () => {
			mockListTools
				.mockResolvedValueOnce({ tools: [{ name: 'search', inputSchema: {} }], nextCursor: 'c1' })
				.mockResolvedValueOnce({ tools: [{ name: 'chat', inputSchema: {} }] });
			const context = createSupplyDataContext({ workspaceId: 'ws-1' });

			const { response } = await node.supplyData.call(context, 0);

			expect(response.getTools().map((tool: { name: string }) => tool.name)).toEqual([
				buildMcpToolName(NODE_NAME, 'search'),
				buildMcpToolName(NODE_NAME, 'chat'),
			]);
		});
	});

	describe('execute', () => {
		it('refuses to run on n8n Cloud', async () => {
			process.env.N8N_DEPLOYMENT_TYPE = 'cloud';
			const context = createExecuteContext([{ tool: 'search' }], { workspaceId: 'ws-1' });

			await expect(node.execute.call(context)).rejects.toThrow(/self-hosted/);
		});

		it('requires a "tool" field on each item', async () => {
			const context = createExecuteContext([{ foo: 'bar' }], { workspaceId: 'ws-1' });

			await expect(node.execute.call(context)).rejects.toThrow(/must have a "tool" field/);
		});

		it('calls the matching tool by its raw pipeline name and returns the response', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'the answer' }] });
			const context = createExecuteContext([{ tool: 'search', query: 'hello' }], {
				workspaceId: 'ws-1',
			});

			const [returnData] = await node.execute.call(context);

			expect(mockCallTool).toHaveBeenCalledWith(
				{ name: 'search', arguments: { query: 'hello' } },
				undefined,
				{ timeout: 60000, signal: undefined },
			);
			expect(returnData).toEqual([
				{ json: { tool: 'search', response: 'the answer' }, pairedItem: { item: 0 } },
			]);
		});

		it('also matches the sanitized/prefixed tool name an agent would have used', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'the answer' }] });
			const context = createExecuteContext([{ tool: buildMcpToolName(NODE_NAME, 'search') }], {
				workspaceId: 'ws-1',
			});

			await node.execute.call(context);

			expect(mockCallTool).toHaveBeenCalledWith(
				{ name: 'search', arguments: {} },
				undefined,
				expect.anything(),
			);
		});

		it('throws when the requested tool is not exposed by this node', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			const context = createExecuteContext([{ tool: 'does-not-exist' }], { workspaceId: 'ws-1' });

			await expect(node.execute.call(context)).rejects.toThrow(
				/not one of the tools currently exposed/,
			);
		});

		it('respects the "Tools to Include"/"Tools to Exclude" filter', async () => {
			mockListTools.mockResolvedValue({
				tools: [
					{ name: 'search', inputSchema: {} },
					{ name: 'chat', inputSchema: {} },
				],
			});
			const context = createExecuteContext([{ tool: 'chat' }], {
				workspaceId: 'ws-1',
				include: 'except',
				excludeTools: ['chat'],
			});

			await expect(node.execute.call(context)).rejects.toThrow(
				/not one of the tools currently exposed/,
			);
		});

		it('excludes the "tool" field itself from the arguments sent to callTool', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
			const context = createExecuteContext([{ tool: 'search', query: 'hello' }], {
				workspaceId: 'ws-1',
			});

			await node.execute.call(context);

			expect(mockCallTool).toHaveBeenCalledWith(
				{ name: 'search', arguments: { query: 'hello' } },
				undefined,
				expect.anything(),
			);
		});

		it('includes structuredContent in the response json when present', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({
				content: [{ type: 'text', text: 'the answer' }],
				structuredContent: { citations: ['doc-1'] },
			});
			const context = createExecuteContext([{ tool: 'search' }], { workspaceId: 'ws-1' });

			const [returnData] = await node.execute.call(context);

			expect(returnData[0].json).toEqual({
				tool: 'search',
				response: 'the answer',
				structuredContent: { citations: ['doc-1'] },
			});
		});

		it('throws when the tool call reports isError', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({
				isError: true,
				content: [{ type: 'text', text: 'crashed' }],
			});
			const context = createExecuteContext([{ tool: 'search' }], { workspaceId: 'ws-1' });

			await expect(node.execute.call(context)).rejects.toThrow(
				/Haystack Enterprise Platform tool "search" failed: crashed/,
			);
		});

		it('pushes an error item instead of throwing when continueOnFail is enabled', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockRejectedValue(new Error('pipeline error'));
			const context = createExecuteContext(
				[{ tool: 'search' }],
				{ workspaceId: 'ws-1' },
				{ continueOnFail: true },
			);

			const [returnData] = await node.execute.call(context);

			expect(returnData).toHaveLength(1);
			expect(returnData[0].json.error).toMatch(/pipeline error/);
			expect(returnData[0].pairedItem).toEqual({ item: 0 });
		});

		it('processes items independently, closing the client after each one', async () => {
			mockListTools.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
			mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
			const context = createExecuteContext(
				[
					{ tool: 'search', a: 1 },
					{ tool: 'search', a: 2 },
				],
				{ workspaceId: 'ws-1' },
			);

			const [returnData] = await node.execute.call(context);

			expect(returnData).toHaveLength(2);
			expect(mockClose).toHaveBeenCalledTimes(2);
		});
	});

	describe('getAvailableMcpTools', () => {
		it('refuses to run on n8n Cloud', async () => {
			process.env.N8N_DEPLOYMENT_TYPE = 'cloud';
			const context = createLoadOptionsContext({ workspaceId: 'ws-1' });

			await expect(node.methods.loadOptions.getAvailableMcpTools.call(context)).rejects.toThrow(
				/self-hosted/,
			);
		});

		it('returns an empty list when no workspace is selected yet', async () => {
			const context = createLoadOptionsContext({ workspaceId: '' });

			expect(await node.methods.loadOptions.getAvailableMcpTools.call(context)).toEqual([]);
			expect(mockConnect).not.toHaveBeenCalled();
		});

		it('lists tools from the selected workspace using the credential API key', async () => {
			mockListTools.mockResolvedValue({
				tools: [{ name: 'search', description: 'Search the knowledge base' }],
			});
			const context = createLoadOptionsContext({ workspaceId: 'ws-1' }, { apiKey: 'secret-key' });

			const options = await node.methods.loadOptions.getAvailableMcpTools.call(context);

			expect(options).toEqual([
				{ name: 'search', value: 'search', description: 'Search the knowledge base' },
			]);
			expect(TransportMock).toHaveBeenCalledWith(
				expect.objectContaining({ href: expect.stringContaining('/workspaces/ws-1/mcp') }),
				expect.objectContaining({
					requestInit: { headers: { Authorization: 'Bearer secret-key' } },
				}),
			);
		});

		it('turns a 403 from a workspace the API key cannot access into a sensible hint, instead of the raw transport error', async () => {
			mockConnect.mockRejectedValue(new StreamableHTTPError(403, 'Forbidden'));
			const context = createLoadOptionsContext({ workspaceId: 'ws-1' });

			const error = await node.methods.loadOptions.getAvailableMcpTools
				.call(context)
				.catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(NodeOperationError);
			expect((error as NodeOperationError).message).toMatch(
				/doesn't have access to this workspace.*org-wide key/s,
			);
		});

		it('adds a credential hint when connecting fails with a 401', async () => {
			mockConnect.mockRejectedValue(new StreamableHTTPError(401, 'Unauthorized'));
			const context = createLoadOptionsContext({ workspaceId: 'ws-1' });

			const error = await node.methods.loadOptions.getAvailableMcpTools
				.call(context)
				.catch((caught: unknown) => caught);

			expect((error as NodeOperationError).message).toMatch(/API key.*valid/);
		});
	});
});
