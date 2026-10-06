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

// Kept in sync by hand with packages/haystack-enterprise/nodes/HaystackEnterprise/utils.ts
// (DEFAULT_API_ORIGIN / normalizeApiOrigin / getApiOriginFromCredentials / getApiBaseUrlV1FromOrigin).
export const DEFAULT_API_ORIGIN = 'https://api.cloud.deepset.ai';
const CREDENTIAL_NAME = 'haystackEnterpriseApi';
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

/**
 * Both credential types carry a `serverUrl`: the API key credential's is the API origin; the
 * OAuth2 credential's is n8n's DCR "Server URL" (the protected resource, i.e. `<origin>/api/v1`).
 * apiOriginWithoutVersionPath() strips the version path so either form yields the same base.
 */
export async function getApiOriginForContext(context: McpContext, itemIndex = 0): Promise<string> {
	const credentialType =
		getAuthenticationMode(context, itemIndex) === 'oAuth2'
			? OAUTH2_CREDENTIAL_NAME
			: CREDENTIAL_NAME;
	const credentials = await context.getCredentials(credentialType);
	return getApiOriginFromCredentials(credentials);
}

/**
 * ILoadOptionsFunctions.getNodeParameter() takes (name, fallback) — there's only ever one "item"
 * in a loadOptions call — while the execute/supplyData contexts take (name, itemIndex, fallback).
 * Calling the former with the latter's argument order would silently pass the item index as the
 * fallback. getCurrentNodeParameter() only exists on the load-options context, so it's the
 * discriminator.
 */
function isLoadOptionsContext(context: McpContext): context is ILoadOptionsFunctions {
	return typeof (context as Partial<ILoadOptionsFunctions>).getCurrentNodeParameter === 'function';
}

/**
 * Reads the node's "Authentication" dropdown (see HaystackEnterpriseMcp.node.ts). Falls back to
 * API Key for workflows saved before the parameter existed.
 */
function getAuthenticationMode(context: McpContext, itemIndex: number): 'apiKey' | 'oAuth2' {
	const authentication = isLoadOptionsContext(context)
		? context.getNodeParameter('authentication', 'apiKey')
		: context.getNodeParameter('authentication', itemIndex, 'apiKey');
	return authentication === 'oAuth2' ? 'oAuth2' : 'apiKey';
}

/**
 * How to put a bearer token on the MCP server requests. The MCP SDK's transport speaks HTTP
 * itself, bypassing n8n's httpRequestWithAuthentication() — which, for OAuth2, is the thing that
 * knows how to refresh an expired access token and persist the new one. So unlike the declarative
 * haystack-enterprise package (which just names the credential type and lets n8n handle auth end
 * to end), this package needs the raw token, plus a way to get a fresh one once it expires.
 */
export interface McpAuth {
	/** The bearer token to send on every request. */
	token: string;
	/** API origin from the active credential's Server URL (see getApiOriginFromCredentials()). */
	apiOrigin: string;
	/**
	 * Only set for OAuth2. Called after the MCP server rejects `token` with a 401; resolves to a
	 * freshly refreshed access token (already persisted on the credential by n8n), or `undefined`
	 * if the refresh itself failed — in which case the 401 is surfaced as-is.
	 */
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

	// `oauthTokenData` is the token response n8n stored when the user clicked "Connect" (and
	// overwrites on every refresh) — it's absent until then.
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
			// n8n's own helper: refreshes via the stored refresh token and persists the result on the
			// credential, exactly as httpRequestWithAuthentication() would after a 401. Throws if there
			// is no refresh token (or the IdP rejects it) — the user has to reconnect in that case.
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
 * Wraps `fetch` to set the Authorization header on every MCP request and, for OAuth2, to retry
 * exactly once with a refreshed token when the server answers 401 — mirroring what n8n's own
 * httpRequestWithAuthentication() does for OAuth2 credentials. Set on the transport's `fetch`
 * option rather than passing a static header via `requestInit` so the header can change after a
 * refresh mid-session (the transport is reused across every tool call an AI Agent makes).
 *
 * MCP request bodies are JSON strings, so re-sending the same `init` is safe. The global `fetch`
 * is looked up per request (not captured once here) so anything patching it at runtime still
 * applies.
 */
export function createBearerFetch(auth: McpAuth, baseFetch?: FetchLike): FetchLike {
	let token = auth.token;

	const send = async (url: string | URL, init: RequestInit | undefined, bearer: string) => {
		const headers = new Headers(init?.headers);
		headers.set('Authorization', `Bearer ${bearer}`);
		return (baseFetch ?? fetch)(url, { ...init, headers });
	};

	return async (url, init) => {
		const response = await send(url, init, token);
		if (response.status !== 401 || !auth.refresh) {
			return response;
		}

		const refreshedToken = await auth.refresh();
		if (!refreshedToken) {
			return response;
		}
		token = refreshedToken;
		return send(url, init, token);
	};
}

/**
 * Builds the MCP client + transport pointed at a workspace's MCP server —
 * shared by loadMcpToolOptions() below and HaystackEnterpriseMcp.node.ts's
 * connectAndListFilteredTools(). Doesn't call `client.connect()` itself since
 * the two callers wrap that call in slightly different error handling
 * (one has an itemIndex to attach, the other doesn't).
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

/**
 * Normalises a raw MCP inputSchema to always be a valid JSON Schema object.
 * Haystack Enterprise Platform (and some other Python MCP servers) serialise Python's
 * None as the string "None", which OpenAI rejects. We force type: "object"
 * and default properties to {} so downstream conversion is always safe.
 */
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
 * Turns a connect()/listTools() auth failure into a short, standalone hint.
 * StreamableHTTPError carries the HTTP status code for transport-level
 * failures, so an invalid API key (401) reads differently from a valid key
 * that just doesn't have access to this workspace (403) — the workspace
 * picker lists every workspace in the organization regardless of what the
 * configured API key can actually reach, so a 403 here almost always means
 * a workspace-scoped key was used with the wrong workspace. Kept short
 * (rather than appended to the raw SDK error) because it's also shown as-is
 * in the small "problem loading the parameter options" popover, which
 * doesn't wrap or grow to fit long text. Deliberately scoped to 401/403 —
 * every other failure (404, 5xx, a plain network error like ECONNREFUSED)
 * already comes with a short, self-explanatory message from the SDK/server,
 * so callers just surface that error's own message instead of synthesizing
 * another one for it.
 */
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

/**
 * Turns a callTool() failure into an actionable hint using the MCP JSON-RPC
 * error code, so a schema mismatch (the agent's fault, usually self-corrected
 * by a retry) reads differently from a pipeline crash (Haystack Enterprise Platform's
 * fault) or a tool that disappeared mid-session (ours to refresh). Returns ''
 * when the error isn't an McpError we can classify.
 */
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

/**
 * Applies the "Tools to Include" mode to the tools returned by the MCP
 * server, mirroring n8n's own MCP Client Tool node so this node's filtering
 * behaves the same way users already expect from other MCP nodes (e.g.
 * Linear MCP, GitLab MCP).
 */
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
 * Haystack Enterprise Platform pipeline names are free text chosen by the user (spaces,
 * punctuation, unicode, ...), but LLM providers require tool/function names to
 * match /^[a-zA-Z0-9_-]+$/ and be at most 64 characters — a pipeline named
 * e.g. "Customer Support Bot" would otherwise break tool-calling with an error
 * that has nothing to do with Haystack Enterprise Platform. Prefixing with the node's
 * own (canvas-unique) name also stops two Haystack Enterprise MCP nodes with
 * same-named pipelines (e.g. two workspaces) from colliding when n8n's AI
 * Agent enforces unique tool names across all connected tool nodes.
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

/**
 * Non-text content blocks (image, audio, resource, resource_link, ...) can't
 * be flattened to plain text, but dropping them means the agent silently
 * never sees that Haystack Enterprise Platform returned them at all — so they're
 * serialized as JSON instead of being filtered out.
 */
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

/**
 * Pipelines that declare an MCP output schema return their typed result via
 * structuredContent (a plain object) alongside or instead of content. Mirrors
 * n8n's own MCP Client Tool node's isStructuredContent check.
 */
export function isStructuredContent(value: unknown): value is Record<string, unknown> {
	return (
		value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
	);
}

/**
 * MCP servers may paginate tools/list via cursor/nextCursor; a single
 * client.listTools() call only returns the first page, silently hiding the
 * rest once a workspace exposes more tools than fit on one page. Follows
 * nextCursor until the server stops returning one, mirroring n8n's own MCP
 * Client Tool node (getAllTools).
 */
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

/**
 * Turns a workspace-listing auth failure into a short, standalone hint —
 * same rationale as describeTransportErrorHint above: n8n's "problem
 * loading the parameter options" popover renders `.message` directly, with
 * no wrapping or growing to fit long text. A 403 here specifically means
 * the API key itself lacks the "list workspaces" permission — distinct from
 * a 403 once a workspace is already selected (that means the key can't
 * reach *that* workspace, handled by describeTransportErrorHint instead).
 */
function describeWorkspaceListErrorHint(httpCode: string | null): string {
	if (httpCode === '401') {
		return 'Check that the API key is valid, or reconnect the OAuth2 credential.';
	}
	if (httpCode === '403') {
		return "This credential doesn't have permission to list workspaces. Use one that has both workspace access and permission to list workspaces.";
	}
	return '';
}

/**
 * GET /api/v1/workspaces responds with a bare array of workspace objects
 * (each with a `name`, `workspace_id`, `languages`, etc.) — not wrapped in
 * an envelope object. The MCP endpoint (v2 API) is keyed by workspace_id
 * (a UUID), not the name/slug the v1 API otherwise uses, so this returns
 * the ID as the option value.
 *
 * workspaceId stays a plain `options` field (not `resourceLocator`) even
 * though that means showing a raw ID rather than a cached name in some
 * places — n8n's loadOptionsDependsOn doesn't reliably re-trigger a
 * dependent dropdown (here, "Tools to Include"/"Tools to Exclude") when the
 * field it depends on is a resourceLocator, a known n8n limitation, not
 * something fixable in this node's code.
 */
export async function loadWorkspaceOptions(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	// This hits the v1 REST API through n8n's own HTTP helper (unlike the MCP transport built by
	// createMcpTransport() above), so naming either credential type here is enough —
	// httpRequestWithAuthentication() handles OAuth2 end to end, including refresh.
	const credentialType =
		getAuthenticationMode(context, 0) === 'oAuth2' ? OAUTH2_CREDENTIAL_NAME : CREDENTIAL_NAME;
	const apiOrigin = await getApiOriginForContext(context);

	let response: unknown;
	try {
		response = await context.helpers.httpRequestWithAuthentication.call(context, credentialType, {
			method: 'GET',
			url: `${getApiBaseUrlV1FromOrigin(apiOrigin)}/workspaces`,
			json: true,
		});
	} catch (caught) {
		// httpRequestWithAuthentication() already wraps the failure in its own
		// NodeApiError — read the httpCode off that shape (reusing the instance
		// rather than constructing a new one: NodeApiError's constructor returns
		// an already-wrapped NodeApiError verbatim, silently ignoring any
		// options passed in), but throw a NodeOperationError instead of it.
		// n8n's own REST client special-cases any error whose serialized
		// `.name` is exactly "NodeApiError": rather than reconstructing a
		// proper `Error` instance client-side like it does for every other
		// error shape, it re-throws the raw parsed JSON body as-is. The
		// "problem loading the parameter options" popover only knows how to
		// read `.message` off a real `instanceof Error`, so it falls back to
		// string-coercing that raw object — producing the literal, useless
		// text "[object Object]" no matter how good `.message` actually is.
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
		// Prefer the short, classified hint for auth errors; otherwise surface
		// the error's own message as-is rather than wrapping it in a synthesized
		// one — this also shows up verbatim in n8n's "problem loading the
		// parameter options" popover, which doesn't wrap or grow to fit long text.
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
