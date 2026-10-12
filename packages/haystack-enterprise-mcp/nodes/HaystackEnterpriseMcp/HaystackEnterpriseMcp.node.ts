import type { ToolFilterMode } from './utils';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { StructuredToolkit } from 'n8n-core';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { z } from 'zod';

import {
	buildMcpToolName,
	contentToString,
	createMcpTransport,
	describeToolCallErrorHint,
	describeTransportErrorHint,
	getSelectedTools,
	isStructuredContent,
	listAllMcpTools,
	loadMcpToolOptions,
	loadWorkspaceOptions,
	normalizeMcpInputSchema,
	resolveMcpAuth,
} from './utils';

const SELF_HOSTED_ONLY_MESSAGE =
	'The Haystack Enterprise MCP node is only available on self-hosted n8n instances.';

function assertSelfHosted(node: INode): void {
	if (process.env.N8N_DEPLOYMENT_TYPE === 'cloud') {
		throw new NodeOperationError(node, SELF_HOSTED_ONLY_MESSAGE);
	}
}

/**
 * Connects to the workspace's MCP server, lists its tools (following
 * pagination), and applies the "Tools to Include"/"Tools to Exclude"
 * filter — shared between supplyData (tools for an AI Agent) and execute
 * (calling one tool directly as a regular workflow step) so both paths
 * connect, list, filter, and fail the same way.
 */
async function connectAndListFilteredTools(
	ctx: ISupplyDataFunctions | IExecuteFunctions,
	itemIndex: number,
): Promise<{
	client: Client;
	mcpTools: Tool[];
	filteredTools: Tool[];
	timeout: number;
	signal: AbortSignal | undefined;
}> {
	const signal = ctx.getExecutionCancelSignal();
	if (signal?.aborted) {
		throw new NodeOperationError(ctx.getNode(), 'Execution was cancelled', { itemIndex });
	}

	const workspaceId = ctx.getNodeParameter('workspaceId', itemIndex) as string;
	const auth = await resolveMcpAuth(ctx, itemIndex);
	const timeout = ctx.getNodeParameter('options.timeout', itemIndex, 60000) as number;

	if (!workspaceId || !auth.token) {
		throw new NodeOperationError(
			ctx.getNode(),
			'A workspace and a valid credential (API key or OAuth2) are required. Select a workspace above and make sure the Haystack Enterprise credential is set up correctly.',
			{ itemIndex },
		);
	}

	const { client, transport, mcpUrl } = createMcpTransport(workspaceId, auth, signal);

	try {
		await client.connect(transport);
	} catch (error) {
		// Prefer the short, classified hint on its own — this error also shows
		// up as-is in n8n's "problem loading the parameter options" popover,
		// which doesn't wrap or grow to fit the full raw SDK message.
		throw new NodeOperationError(
			ctx.getNode(),
			describeTransportErrorHint(error) ||
				`Failed to connect to the Haystack Enterprise Platform MCP server at ${mcpUrl}: ${(error as Error).message}`,
			{ itemIndex },
		);
	}

	let mcpTools: Tool[];
	try {
		mcpTools = await listAllMcpTools(client, { signal });
	} catch (error) {
		await client.close();
		throw new NodeOperationError(
			ctx.getNode(),
			describeTransportErrorHint(error) ||
				`Failed to list tools from the Haystack Enterprise Platform MCP server: ${(error as Error).message}`,
			{ itemIndex },
		);
	}

	if (mcpTools.length === 0) {
		await client.close();
		throw new NodeOperationError(
			ctx.getNode(),
			'No MCP tools found. Enable at least one pipeline as a tool in Haystack Enterprise Platform under Settings → Workspace → MCP.',
			{ itemIndex },
		);
	}

	const includeMode = ctx.getNodeParameter('include', itemIndex, 'all') as ToolFilterMode;
	const includeTools = ctx.getNodeParameter('includeTools', itemIndex, []) as string[];
	const excludeTools = ctx.getNodeParameter('excludeTools', itemIndex, []) as string[];
	const filteredTools = getSelectedTools({
		mode: includeMode,
		includeTools,
		excludeTools,
		tools: mcpTools,
	});

	if (filteredTools.length === 0) {
		await client.close();
		const message =
			includeMode === 'except'
				? 'All available tools were excluded by the "Tools to Exclude" selection. Remove some exclusions, or choose "All" to expose every tool to the AI Agent.'
				: 'None of the selected tools are currently available from the MCP server. Adjust the "Tools to Include" selection, or choose "All" to use all available tools.';
		throw new NodeOperationError(ctx.getNode(), message, { itemIndex });
	}

	if (includeMode === 'selected' && includeTools.length > 0) {
		const availableToolNames = new Set(mcpTools.map((t) => t.name));
		const missingSelectedTools = includeTools.filter((name) => !availableToolNames.has(name));
		if (missingSelectedTools.length > 0) {
			ctx.addExecutionHints({
				message: `These selected tools are no longer available from the Haystack Enterprise Platform MCP server and were skipped: ${missingSelectedTools.join(', ')}. Refresh the "Tools to Include" list to update the selection.`,
				type: 'warning',
				location: 'outputPane',
			});
		}
	}

	return { client, mcpTools, filteredTools, timeout, signal };
}

export class HaystackEnterpriseMcp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Haystack Enterprise MCP',
		name: 'haystackEnterpriseMcp',
		icon: 'file:haystack-enterprise-electric-blue.svg',
		group: ['transform'],
		version: 1,
		description:
			"Connects to a Haystack Enterprise Platform workspace's MCP server and exposes your enabled pipelines as tools for an AI Agent. Self-hosted n8n only.",
		subtitle: '={{$parameter["workspaceId"]}}',
		defaults: {
			name: 'Haystack Enterprise MCP',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://docs.cloud.deepset.ai/docs/use-pipeline-as-mcp-tool',
					},
				],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiTool],
		outputNames: ['Tool'],
		credentials: [
			{
				name: 'haystackEnterpriseApi',
				required: true,
				displayOptions: { show: { authentication: ['apiKey'] } },
			},
			{
				name: 'haystackEnterpriseOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
		],
		properties: [
			{
				displayName:
					'This node is only available on self-hosted n8n instances. It does not work on n8n Cloud.',
				name: 'selfHostedNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				options: [
					{
						name: 'API Key',
						value: 'apiKey',
						description: 'Authenticate with a Haystack Enterprise API key',
					},
					{
						name: 'OAuth2',
						value: 'oAuth2',
						description: 'Sign in with your Haystack Enterprise user account',
					},
				],
				default: 'apiKey',
			},
			{
				displayName:
					'Make sure you have created an MCP server and enabled at least one pipeline as a tool in Haystack Enterprise Platform under Settings → Workspace → MCP. See the <a href="https://docs.cloud.deepset.ai/docs/use-pipeline-as-mcp-tool/" target="_blank" rel="noopener noreferrer">docs on using a pipeline as an MCP tool</a>.',
				name: 'mcpServerNotice',
				type: 'notice',
				default: '',
			},
			{
				// n8n's loadOptionsDependsOn doesn't reliably re-trigger a
				// dependent dropdown ("Tools to Include"/"Tools to Exclude" below)
				// when the field it depends on is a resourceLocator (a known n8n
				// limitation) — so this stays a plain `options` field instead,
				// which keeps that live refresh working correctly.
				displayName: 'Workspace Name or ID',
				name: 'workspaceId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getWorkspaces',
					loadOptionsDependsOn: ['authentication'],
				},
				default: '',
				required: true,
				description:
					'Select your <a href="https://docs.cloud.deepset.ai/docs/basic-concepts#workspace" target="_blank" rel="noopener noreferrer">workspace</a>, populated from your Haystack Enterprise Platform account. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Tools to Include',
				name: 'include',
				type: 'options',
				default: 'all',
				description:
					'How to select the <a href="https://docs.cloud.deepset.ai/docs/use-pipeline-as-mcp-tool/" target="_blank" rel="noopener noreferrer">tools</a> you want to be exposed to the AI Agent',
				options: [
					{
						name: 'All',
						value: 'all',
						description: 'Expose every tool from the Haystack Enterprise Platform MCP server',
					},
					{
						name: 'All Except',
						value: 'except',
						description: 'Expose all tools except those listed in "Tools to Exclude"',
					},
					{
						name: 'Selected',
						value: 'selected',
						description: 'Only expose the tools listed in "Tools to Include"',
					},
				],
			},
			{
				displayName: 'Tools to Include',
				name: 'includeTools',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getAvailableMcpTools',
					loadOptionsDependsOn: ['authentication', 'workspaceId'],
				},
				default: [],
				description:
					'The <a href="https://docs.cloud.deepset.ai/docs/use-pipeline-as-mcp-tool/" target="_blank" rel="noopener noreferrer">tools</a> currently available from your Haystack Enterprise Platform MCP server. Click the refresh icon to load the list. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { include: ['selected'] } },
			},
			{
				displayName: 'Tools to Exclude',
				name: 'excludeTools',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getAvailableMcpTools',
					loadOptionsDependsOn: ['authentication', 'workspaceId'],
				},
				default: [],
				description:
					'The <a href="https://docs.cloud.deepset.ai/docs/use-pipeline-as-mcp-tool/" target="_blank" rel="noopener noreferrer">tools</a> currently available from your Haystack Enterprise Platform MCP server. Click the refresh icon to load the list. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { include: ['except'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				description: 'Additional options to add',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 60000,
						description: 'Time in ms to wait for a pipeline call to finish',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getWorkspaces(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadWorkspaceOptions(this);
			},

			async getAvailableMcpTools(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				assertSelfHosted(this.getNode());

				const workspaceId = this.getNodeParameter('workspaceId') as string;
				if (!workspaceId) {
					return [];
				}

				return loadMcpToolOptions(this, workspaceId, await resolveMcpAuth(this, 0));
			},
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		assertSelfHosted(this.getNode());

		const { client, filteredTools, timeout, signal } = await connectAndListFilteredTools(
			this,
			itemIndex,
		);

		const toolsMissingDescription = filteredTools.filter((t) => !t.description).map((t) => t.name);
		if (toolsMissingDescription.length > 0) {
			this.addExecutionHints({
				message: `These tools have no description set in Haystack Enterprise Platform, so the AI agent only sees their name, which can make it pick the wrong tool: ${toolsMissingDescription.join(', ')}. Add a description under Settings → Workspace → MCP.`,
				type: 'info',
				location: 'outputPane',
			});
		}

		const tools = filteredTools.map((mcpTool) => {
			// Create the tool with a placeholder Zod schema, then immediately replace
			// tool.schema with the raw JSON Schema object. N8n's normalizeToolSchema
			// checks `tool.schema instanceof N8nZod.ZodType` — because we bundle a
			// different Zod version, our Zod objects fail that check and normalizeToolSchema
			// calls convertJsonSchemaToZod() thinking the schema is already JSON Schema.
			// By storing the raw JSON Schema here, normalizeToolSchema converts it
			// correctly with N8n's own Zod, and OpenAI receives a valid function schema.
			const tool = new DynamicStructuredTool({
				// LangChain-facing name only — sanitized and namespaced by node name so
				// free-text pipeline names stay valid for LLM providers and don't collide
				// across multiple Haystack Enterprise MCP nodes on the same canvas. The
				// actual MCP tool call below always uses the real mcpTool.name.
				name: buildMcpToolName(this.getNode().name, mcpTool.name),
				description: mcpTool.description ?? mcpTool.name,
				schema: z.object({}), // placeholder — replaced below
				func: async (input: Record<string, unknown>) => {
					// addInputData/addOutputData attach this call to the node's own
					// execution trace so each invocation is individually inspectable in
					// the n8n UI, rather than disappearing into the agent's internal
					// LangChain run. This node exposes many differently-named pipeline
					// tools from a single canvas node, so the tool name is included
					// in the traced data itself — otherwise every call in the panel
					// looks identical and you can't tell which pipeline actually ran.
					// logAiEvent feeds n8n's AI-specific run log with the same name.
					const { index: runIndex } = this.addInputData(NodeConnectionTypes.AiTool, [
						[{ json: { tool: mcpTool.name, input: input as IDataObject } }],
					]);

					let output: string;
					try {
						const result = await client.callTool(
							{
								name: mcpTool.name,
								arguments: input,
							},
							undefined,
							{ timeout, signal },
						);
						// MCP tool calls can report a pipeline-level failure via isError on
						// an otherwise valid response, instead of throwing — without this
						// check that failure would reach the agent as if it had succeeded.
						// Thrown here (rather than handled inline) so it flows through the
						// same wrapping/tracing/hint logic as a thrown callTool error below.
						if (result.isError) {
							throw new NodeOperationError(
								this.getNode(),
								contentToString(result.content) ||
									'The pipeline reported an error with no message.',
								{ itemIndex },
							);
						}
						// Pipelines that declare an MCP output schema return their typed
						// result via structuredContent alongside (or instead of) content —
						// append it so structured output isn't silently dropped.
						output = [
							contentToString(result.content),
							isStructuredContent(result.structuredContent)
								? JSON.stringify(result.structuredContent)
								: '',
						]
							.filter(Boolean)
							.join('\n');
					} catch (err) {
						const hint = describeToolCallErrorHint(err);
						const error = new NodeOperationError(
							this.getNode(),
							`Haystack Enterprise Platform tool "${mcpTool.name}" failed: ${(err as Error).message}${hint ? ` — ${hint}` : ''}`,
							{ itemIndex },
						);
						this.addOutputData(NodeConnectionTypes.AiTool, runIndex, error);
						throw error;
					}

					this.addOutputData(NodeConnectionTypes.AiTool, runIndex, [
						[{ json: { tool: mcpTool.name, response: output } }],
					]);
					this.logAiEvent(
						'ai-tool-called',
						`Called Haystack Enterprise Platform tool "${mcpTool.name}"`,
					);
					return output;
				},
			});

			// Override with the sanitized raw JSON Schema so N8n can convert it
			(tool as unknown as { schema: unknown }).schema = normalizeMcpInputSchema(
				mcpTool.inputSchema,
			);

			return tool;
		});

		return {
			// n8n's own code (getConnectedTools, ToolExecutor, extendResponseMetadata)
			// only recognizes a single LangChain Tool or an n8n-core StructuredToolkit
			// as a supplyData response — a bare array of tools isn't a documented
			// shape. It happens to work for a live Agent run (an incidental flatMap
			// side effect elsewhere), but breaks n8n's "Execute step" tool-testing
			// path, which expects a real StructuredToolkit with a getTools() method.
			response: new StructuredToolkit(tools),
			// The client/transport stay open for the lifetime of the agent's tool
			// calls, so close them only once n8n tears down this sub-node's scope
			// (e.g. when the workflow execution finishes), instead of leaking an
			// open MCP connection per run.
			closeFunction: async () => {
				await client.close();
			},
		};
	}

	/**
	 * Lets this node be run as a regular workflow step (rather than only as
	 * an AI Agent's tool sub-node) to call one Haystack Enterprise Platform pipeline
	 * directly — e.g. to smoke-test the MCP connection, or to call a pipeline
	 * from a plain workflow without going through an agent. Each input item's
	 * "tool" field selects the pipeline; every other field becomes its
	 * arguments. Respects the same "Tools to Include"/"Tools to Exclude"
	 * filter as supplyData, so execute() can't reach tools the agent
	 * wouldn't see either.
	 */
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		assertSelfHosted(this.getNode());

		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const item = items[itemIndex];
			let client: Client | undefined;
			try {
				const toolName = item.json.tool;
				if (typeof toolName !== 'string' || !toolName) {
					throw new NodeOperationError(
						this.getNode(),
						'Each input item must have a "tool" field naming which Haystack Enterprise Platform pipeline to call. Every other field on the item becomes that pipeline\'s arguments.',
						{ itemIndex },
					);
				}

				const connected = await connectAndListFilteredTools(this, itemIndex);
				client = connected.client;
				const { filteredTools, timeout, signal } = connected;

				const mcpTool = filteredTools.find(
					(t) => t.name === toolName || buildMcpToolName(this.getNode().name, t.name) === toolName,
				);
				if (!mcpTool) {
					throw new NodeOperationError(
						this.getNode(),
						`Tool "${toolName}" is not one of the tools currently exposed by this node (the "Tools to Include"/"Tools to Exclude" selection applies here too). Available: ${filteredTools.map((t) => t.name).join(', ')}.`,
						{ itemIndex },
					);
				}

				const toolArguments: IDataObject = { ...(item.json as IDataObject) };
				delete toolArguments.tool;

				let result: Awaited<ReturnType<Client['callTool']>>;
				try {
					result = await client.callTool(
						{ name: mcpTool.name, arguments: toolArguments },
						undefined,
						{ timeout, signal },
					);
					if (result.isError) {
						throw new NodeOperationError(
							this.getNode(),
							contentToString(result.content) || 'The pipeline reported an error with no message.',
							{ itemIndex },
						);
					}
				} catch (err) {
					const hint = describeToolCallErrorHint(err);
					throw new NodeOperationError(
						this.getNode(),
						`Haystack Enterprise Platform tool "${mcpTool.name}" failed: ${(err as Error).message}${hint ? ` — ${hint}` : ''}`,
						{ itemIndex },
					);
				}

				returnData.push({
					json: {
						tool: mcpTool.name,
						response: contentToString(result.content),
						...(isStructuredContent(result.structuredContent)
							? { structuredContent: result.structuredContent }
							: {}),
					},
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			} finally {
				if (client) {
					await client.close();
				}
			}
		}

		return [returnData];
	}
}
