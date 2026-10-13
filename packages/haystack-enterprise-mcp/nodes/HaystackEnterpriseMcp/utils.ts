import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
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

// Keep in sync with packages/haystack-enterprise/nodes/HaystackEnterprise/utils.ts
// (DEFAULT_API_ORIGIN / normalizeApiOrigin / getApiOriginFromCredentials / getApiBaseUrlV1FromOrigin).
export const DEFAULT_API_ORIGIN = 'https://api.cloud.deepset.ai';
const CREDENTIAL_NAME = 'haystackEnterpriseApi';
// Credential type name, not a secret.
// eslint-disable-next-line @n8n/community-nodes/no-hardcoded-secrets
const OAUTH2_CREDENTIAL_NAME = 'haystackEnterpriseOAuth2Api';
const MCP_CLIENT_NAME = 'n8n-nodes-haystack-enterprise-mcp';
const MCP_CLIENT_VERSION = '0.1.0';

type McpContext = IExecuteFunctions | ISupplyDataFunctions | ILoadOptionsFunctions;

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

function apiOriginWithoutVersionPath(origin: string): string {
	return normalizeApiOrigin(origin).replace(/\/api\/v[12]$/i, '');
}

export function getApiBaseUrlV1FromOrigin(origin: string): string {
	return `${apiOriginWithoutVersionPath(origin)}/api/v1`;
}

export function getApiBaseUrlV2FromOrigin(origin: string): string {
	return `${apiOriginWithoutVersionPath(origin)}/api/v2`;
}

/**
 * Load-options contexts use `getNodeParameter(name, fallback)` while execution contexts include
 * an item index. Calling the former with three arguments silently changes its fallback value.
 */
function isLoadOptionsContext(context: McpContext): context is ILoadOptionsFunctions {
	return typeof (context as Partial<ILoadOptionsFunctions>).getCurrentNodeParameter === 'function';
}

function getAuthenticationMode(context: McpContext, itemIndex: number): 'apiKey' | 'oAuth2' {
	const authentication = isLoadOptionsContext(context)
		? context.getNodeParameter('authentication')
		: context.getNodeParameter('authentication', itemIndex);
	if (authentication !== 'apiKey' && authentication !== 'oAuth2') {
		throw new NodeOperationError(context.getNode(), 'Select an authentication method.');
	}
	return authentication;
}

/** Authentication state for an MCP transport, which bypasses n8n's authenticated HTTP helper. */
export interface McpAuth {
	token: string;
	apiOrigin: string;
	/** Refreshes and persists an OAuth2 token after a 401 response. */
	refresh?: () => Promise<string | undefined>;
}

export async function resolveMcpAuth(context: McpContext, itemIndex: number): Promise<McpAuth> {
	if (getAuthenticationMode(context, itemIndex) === 'apiKey') {
		const credentials = await context.getCredentials(CREDENTIAL_NAME);
		return {
			token: credentials.apiKey as string,
			apiOrigin: getApiOriginFromCredentials(credentials),
		};
	}

	const credentials = await context.getCredentials(OAUTH2_CREDENTIAL_NAME);
	const accessToken = (credentials.oauthTokenData as { access_token?: unknown } | undefined)
		?.access_token;
	if (typeof accessToken !== 'string' || !accessToken) {
		throw new NodeOperationError(
			context.getNode(),
			'The Haystack Enterprise OAuth2 credential is not connected yet. Open the credential and click "Connect".',
		);
	}

	return {
		token: accessToken,
		apiOrigin: getApiOriginFromCredentials(credentials),
		refresh: async () => {
			try {
				const refreshed = (await context.helpers.refreshOAuth2Token.call(
					context,
					OAUTH2_CREDENTIAL_NAME,
				)) as { access_token?: unknown } | undefined;
				return typeof refreshed?.access_token === 'string' && refreshed.access_token
					? refreshed.access_token
					: undefined;
			} catch {
				return undefined;
			}
		},
	};
}

/**
 * Adds bearer authentication and retries one 401 response after refreshing OAuth2 credentials.
 * The token is applied per request because the transport is reused after refresh.
 */
export function createBearerFetch(auth: McpAuth, baseFetch?: FetchLike): FetchLike {
	let token = auth.token;
	let refreshInFlight: Promise<string | undefined> | undefined;

	const send = async (url: string | URL, init: RequestInit | undefined, bearer: string) => {
		const headers = new Headers(init?.headers);
		headers.set('Authorization', `Bearer ${bearer}`);
		return (baseFetch ?? fetch)(url, { ...init, headers });
	};

	return async (url, init) => {
		const attemptedToken = token;
		const response = await send(url, init, attemptedToken);
		if (response.status !== 401 || !auth.refresh) {
			return response;
		}

		if (token !== attemptedToken) {
			await response.body?.cancel().catch(() => undefined);
			return send(url, init, token);
		}

		refreshInFlight ??= auth.refresh().finally(() => {
			refreshInFlight = undefined;
		});
		const refreshedToken = await refreshInFlight;
		if (!refreshedToken) {
			return response;
		}
		await response.body?.cancel().catch(() => undefined);
		token = refreshedToken;
		return send(url, init, token);
	};
}

/**
 * Creates an unconnected MCP client and transport for a workspace.
 */
export function createMcpTransport(
	workspaceId: string,
	auth: McpAuth,
	signal?: AbortSignal,
): { client: Client; transport: StreamableHTTPClientTransport; mcpUrl: string } {
	const mcpUrl = `${getApiBaseUrlV2FromOrigin(auth.apiOrigin)}/workspaces/${workspaceId}/mcp`;
	const client = new Client({ name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION });
	const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
		fetch: createBearerFetch(auth),
		requestInit: { signal },
	});
	return { client, transport, mcpUrl };
}

/** Normalizes malformed MCP input schemas for downstream providers. */
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

/** Returns concise guidance for MCP authentication and authorization failures. */
export function describeTransportErrorHint(error: unknown): string {
	if (error instanceof StreamableHTTPError) {
		if (error.code === 401) {
			return 'Check that the API key is valid, or reconnect the OAuth2 credential.';
		}
		if (error.code === 403) {
			return "This credential doesn't have access to this workspace. Use a workspace-level one for it, or an org-wide one.";
		}
	}
	return '';
}

/** Returns actionable guidance for recognized MCP tool-call failures. */
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

/** Applies the node's include or exclude filter to MCP tools. */
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
 * Converts free-text pipeline names into provider-compatible names and prefixes the node name to
 * avoid collisions across MCP nodes.
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

/** Preserves non-text MCP content by serializing it as JSON. */
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

/** Checks whether an MCP response contains structured output. */
export function isStructuredContent(value: unknown): value is Record<string, unknown> {
	return (
		value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
	);
}

/** Lists all MCP tools by following pagination cursors. */
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

/** Returns concise guidance for workspace-listing authorization failures. */
function describeWorkspaceListErrorHint(httpCode: string | null): string {
	if (httpCode === '401') {
		return 'Check that the API key is valid, or reconnect the OAuth2 credential.';
	}
	if (httpCode === '403') {
		return "This credential doesn't have permission to list workspaces.";
	}
	return '';
}

/** Maps the v1 workspace response to the IDs required by the v2 MCP endpoint. */
export async function loadWorkspaceOptions(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const credentialType =
		getAuthenticationMode(context, 0) === 'oAuth2' ? OAUTH2_CREDENTIAL_NAME : CREDENTIAL_NAME;
	const credentials = await context.getCredentials(credentialType);
	const apiOrigin = getApiOriginFromCredentials(credentials);

	let response: unknown;
	try {
		response = await context.helpers.httpRequestWithAuthentication.call(context, credentialType, {
			method: 'GET',
			url: `${getApiBaseUrlV1FromOrigin(apiOrigin)}/workspaces`,
			json: true,
		});
	} catch (caught) {
		// NodeOperationError keeps load-options failures readable in n8n's parameter popover.
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
	auth: McpAuth,
): Promise<INodePropertyOptions[]> {
	const { client, transport } = createMcpTransport(workspaceId, auth);

	try {
		await client.connect(transport);
	} catch (error) {
		// Keep parameter-popover errors concise.
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
