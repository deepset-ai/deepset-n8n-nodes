import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	ISupplyDataFunctions,
	JsonObject,
} from 'n8n-workflow';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
	StreamableHTTPClientTransport,
	StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

// Kept in sync by hand with packages/haystack-enterprise/nodes/HaystackEnterprise/utils.ts.
export const DEFAULT_API_ORIGIN = 'https://api.cloud.deepset.ai';
const CREDENTIAL_NAME = 'haystackEnterpriseApi';
const MCP_CLIENT_NAME = 'n8n-nodes-haystack-enterprise-mcp';
const MCP_CLIENT_VERSION = '0.1.0';

export function normalizeApiOrigin(serverUrl: string): string {
	return serverUrl.trim().replace(/\/+$/, '');
}

export function getApiOriginFromCredentials(credentials: IDataObject): string {
	const serverUrl = credentials.serverUrl;
	if (typeof serverUrl === 'string' && serverUrl.trim() !== '') {
		return normalizeApiOrigin(serverUrl);
	}
	return DEFAULT_API_ORIGIN;
}

/** Strips a trailing `/api/v1` or `/api/v2` so versioned base URLs are not doubled. */
function apiOriginWithoutVersionPath(origin: string): string {
	const withoutVersion = normalizeApiOrigin(origin).replace(/\/api\/v[12]$/i, '');
	return withoutVersion === '' ? DEFAULT_API_ORIGIN : withoutVersion;
}

export function getApiBaseUrlV1FromOrigin(origin: string): string {
	return `${apiOriginWithoutVersionPath(origin)}/api/v1`;
}

export function getApiBaseUrlV2FromOrigin(origin: string): string {
	return `${apiOriginWithoutVersionPath(origin)}/api/v2`;
}

export async function getApiOriginForContext(
	context: IExecuteFunctions | ILoadOptionsFunctions | ISupplyDataFunctions,
): Promise<string> {
	const credentials = await context.getCredentials(CREDENTIAL_NAME);
	return getApiOriginFromCredentials(credentials);
}

/** Builds the MCP client and transport for a workspace; callers run `client.connect()` themselves. */
export function createMcpTransport(
	workspaceId: string,
	apiKey: string,
	apiOrigin: string,
	signal?: AbortSignal,
): { client: Client; transport: StreamableHTTPClientTransport; mcpUrl: string } {
	const mcpUrl = `${getApiBaseUrlV2FromOrigin(apiOrigin)}/workspaces/${workspaceId}/mcp`;
	const client = new Client({ name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION });
	const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
		requestInit: { headers: { Authorization: `Bearer ${apiKey}` }, signal },
	});
	return { client, transport, mcpUrl };
}

/** Normalises a raw MCP inputSchema to a valid JSON Schema object (`type: "object"`, default `properties`). */
export function normalizeMcpInputSchema(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { type: 'object', properties: {} };
	}
	const schema = raw as Record<string, unknown>;
	return {
		...schema,
		type: 'object',
		properties:
			typeof schema.properties === 'object' && schema.properties !== null ? schema.properties : {},
	};
}

/**
 * Short hint for a 401/403 from connect()/listTools(). Kept short because n8n shows it
 * in a small popover; other failures already have self-explanatory messages.
 */
export function describeTransportErrorHint(error: unknown): string {
	if (error instanceof StreamableHTTPError) {
		if (error.code === 401) {
			return 'Check that the API key in this credential is valid.';
		}
		if (error.code === 403) {
			return "This API key doesn't have access to this workspace. Use a workspace-level key for it, or an org-wide key.";
		}
	}
	return '';
}

/** Maps a callTool() MCP error code to an actionable hint; '' if the error isn't classifiable. */
export function describeToolCallErrorHint(error: unknown): string {
	if (error instanceof McpError) {
		if (error.code === ErrorCode.InvalidParams) {
			return "the AI agent's input didn't match this tool's expected parameters. It may retry with corrected input; if it keeps failing, check the pipeline's required inputs in Haystack Enterprise Platform.";
		}
		if (error.code === ErrorCode.MethodNotFound) {
			return 'this tool is no longer available on the MCP server. It may have been removed or disabled in Haystack Enterprise Platform — refresh the "Tools to Include"/"Tools to Exclude" list on this node.';
		}
		if (error.code === ErrorCode.InternalError) {
			return "the underlying Haystack Enterprise Platform pipeline failed while running. Check the pipeline's configuration and logs in Haystack Enterprise Platform.";
		}
	}
	return '';
}

export type ToolFilterMode = 'all' | 'selected' | 'except';

/** Applies the "Tools to Include" mode, matching n8n's MCP Client Tool node. */
export function getSelectedTools<T extends { name: string }>({
	mode,
	includeTools,
	excludeTools,
	tools,
}: {
	mode: ToolFilterMode;
	includeTools: string[];
	excludeTools: string[];
	tools: T[];
}): T[] {
	switch (mode) {
		case 'selected': {
			if (!includeTools.length) return tools;
			const include = new Set(includeTools);
			return tools.filter((tool) => include.has(tool.name));
		}
		case 'except': {
			const exclude = new Set(excludeTools);
			return tools.filter((tool) => !exclude.has(tool.name));
		}
		case 'all':
		default:
			return tools;
	}
}

const MAX_MCP_TOOL_NAME_LENGTH = 64;

/**
 * Builds an LLM-safe tool name (/^[a-zA-Z0-9_-]+$/, max 64 chars), prefixed with the
 * node name so same-named tools on different nodes don't collide.
 */
export function buildMcpToolName(nodeName: string, toolName: string): string {
	const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
	const sanitizedNodeName = sanitize(nodeName);
	const sanitizedToolName = sanitize(toolName);

	const fullName = `${sanitizedNodeName}_${sanitizedToolName}`;
	if (fullName.length <= MAX_MCP_TOOL_NAME_LENGTH) {
		return fullName;
	}

	const maxPrefixLength = MAX_MCP_TOOL_NAME_LENGTH - sanitizedToolName.length - 1;
	if (maxPrefixLength > 0) {
		return `${sanitizedNodeName.slice(0, maxPrefixLength)}_${sanitizedToolName}`;
	}
	return sanitizedToolName.slice(0, MAX_MCP_TOOL_NAME_LENGTH);
}

type McpContent = { type: string; text?: string; [key: string]: unknown };

/** Flattens MCP content to text; non-text blocks are serialized as JSON rather than dropped. */
export function contentToString(content: unknown): string {
	if (content === undefined || content === null) return '';
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return (content as McpContent[])
			.map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : JSON.stringify(c)))
			.join('\n');
	}
	return JSON.stringify(content);
}

/** True if `value` is a plain object usable as MCP `structuredContent`. */
export function isStructuredContent(value: unknown): value is Record<string, unknown> {
	return (
		value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
	);
}

/** Lists all tools, following `nextCursor` pagination. */
export async function listAllMcpTools(client: Client, options?: RequestOptions): Promise<Tool[]> {
	const tools: Tool[] = [];
	let cursor: string | undefined;
	do {
		const response: { tools: Tool[]; nextCursor?: string } = await client.listTools(
			cursor ? { cursor } : undefined,
			options,
		);
		tools.push(...response.tools);
		cursor = response.nextCursor;
	} while (cursor);
	return tools;
}

/** Short hint for a 401/403 when listing workspaces (403 here means the key can't list workspaces). */
function describeWorkspaceListErrorHint(httpCode: string | null): string {
	if (httpCode === '401') {
		return 'Check that the API key in this credential is valid.';
	}
	if (httpCode === '403') {
		return "This API key doesn't have permission to list workspaces. Use a key that has both workspace access and permission to list workspaces.";
	}
	return '';
}

/**
 * Lists workspaces from GET /api/v1/workspaces (a bare array). The MCP endpoint is keyed
 * by `workspace_id`, so that is used as the option value.
 */
export async function loadWorkspaceOptions(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const apiOrigin = await getApiOriginForContext(context);
	let response: unknown;
	try {
		response = await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL_NAME, {
			method: 'GET',
			url: `${getApiBaseUrlV1FromOrigin(apiOrigin)}/workspaces`,
			json: true,
		});
	} catch (caught) {
		// Read httpCode off the NodeApiError but throw a NodeOperationError: n8n's UI
		// shows "[object Object]" for a thrown NodeApiError in the options popover.
		const error =
			caught instanceof NodeApiError
				? caught
				: new NodeApiError(context.getNode(), caught as JsonObject);
		const hint = describeWorkspaceListErrorHint(error.httpCode);
		const message =
			hint ||
			(typeof error.message === 'string' && error.message !== '[object Object]'
				? error.message
				: 'Failed to list workspaces from Haystack Enterprise Platform.');
		throw new NodeOperationError(context.getNode(), message);
	}

	const workspaces = Array.isArray(response) ? (response as IDataObject[]) : [];
	return workspaces
		.filter(
			(workspace) =>
				typeof workspace.name === 'string' && typeof workspace.workspace_id === 'string',
		)
		.map((workspace) => {
			const name = workspace.name as string;
			return {
				name: name.charAt(0).toUpperCase() + name.slice(1),
				value: workspace.workspace_id as string,
			};
		});
}

export async function loadMcpToolOptions(
	context: ILoadOptionsFunctions,
	workspaceId: string,
	apiKey: string,
): Promise<INodePropertyOptions[]> {
	const apiOrigin = await getApiOriginForContext(context);
	const { client, transport } = createMcpTransport(workspaceId, apiKey, apiOrigin);

	try {
		await client.connect(transport);
	} catch (error) {
		// Prefer the short auth hint; otherwise surface the error's own message.
		throw new NodeOperationError(
			context.getNode(),
			describeTransportErrorHint(error) || (error as Error).message,
		);
	}

	try {
		const tools = await listAllMcpTools(client);
		return tools.map((tool) => ({
			name: tool.name,
			value: tool.name,
			description: tool.description ?? '',
		}));
	} catch (error) {
		throw new NodeOperationError(
			context.getNode(),
			describeTransportErrorHint(error) || (error as Error).message,
		);
	} finally {
		await client.close();
	}
}
