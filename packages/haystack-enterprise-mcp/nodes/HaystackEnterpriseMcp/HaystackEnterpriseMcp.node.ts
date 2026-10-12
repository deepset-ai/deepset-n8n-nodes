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
 * Connects to a workspace MCP server and returns tools matching the node's filter.
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
		// Keep parameter-popover errors concise.
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
				// Plain options keep dependent tool lists refreshable in n8n.
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
			// Use raw JSON Schema so n8n can convert it with its own Zod version.
			const tool = new DynamicStructuredTool({
				// Provider-facing names must be valid and unique across node instances.
				name: buildMcpToolName(this.getNode().name, mcpTool.name),
				description: mcpTool.description ?? mcpTool.name,
				schema: z.object({}), // placeholder — replaced below
				func: async (input: Record<string, unknown>) => {
					// Record each tool call in the node's execution and AI traces.
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
						// MCP failures may be returned as successful responses with `isError`.
						if (result.isError) {
							throw new NodeOperationError(
								this.getNode(),
								contentToString(result.content) ||
									'The pipeline reported an error with no message.',
								{ itemIndex },
							);
						}
						// Preserve typed MCP output returned alongside text content.
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

			// Replace the cross-version Zod placeholder with JSON Schema.
			(tool as unknown as { schema: unknown }).schema = normalizeMcpInputSchema(
				mcpTool.inputSchema,
			);

			return tool;
		});

		return {
			// StructuredToolkit supports both agent runs and n8n's tool-testing path.
			response: new StructuredToolkit(tools),
			// Keep the MCP connection open while the agent can invoke tools.
			closeFunction: async () => {
				await client.close();
			},
		};
	}

	/**
	 * Calls one filtered MCP tool per input item when used as a regular workflow step.
	 * The `tool` field selects the tool; remaining fields become its arguments.
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
