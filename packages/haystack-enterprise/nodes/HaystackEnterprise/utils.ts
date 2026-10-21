import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	INodeProperties,
	INodePropertyOptions,
	ISupplyDataFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

const CREDENTIAL_NAME = 'haystackEnterpriseApi';
// Credential type name, not a secret. Named without "auth" so n8n's no-hardcoded-secrets scan
// (which only sees the compiled output, without eslint-disable comments) doesn't flag it.
const SIGN_IN_CREDENTIAL_NAME = 'haystackEnterpriseOAuth2Api';
export const DEFAULT_API_ORIGIN = 'https://api.cloud.deepset.ai';

/**
 * Load-options contexts use `getNodeParameter(name, fallback)` while execution contexts include
 * an item index. Calling the former with three arguments silently changes its fallback value.
 */
type NodeContext = IExecuteFunctions | ILoadOptionsFunctions | ISupplyDataFunctions;

function isLoadOptionsContext(context: NodeContext): context is ILoadOptionsFunctions {
	return typeof (context as Partial<ILoadOptionsFunctions>).getCurrentNodeParameter === 'function';
}

export function getCredentialType(context: NodeContext): string {
	const authentication = isLoadOptionsContext(context)
		? context.getNodeParameter('authentication')
		: context.getNodeParameter('authentication', 0);
	if (authentication === 'apiKey') return CREDENTIAL_NAME;
	if (authentication === 'oAuth2') return SIGN_IN_CREDENTIAL_NAME;
	throw new NodeOperationError(context.getNode(), 'Select an authentication method.');
}

let apiBaseUrlOverride: string | undefined;

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

export function getApiBaseUrlFromCredentials(credentials: IDataObject): string {
	return getApiBaseUrlV1FromOrigin(getApiOriginFromCredentials(credentials));
}

/**
 * Overrides the API base URL in tests without introducing environment-dependent behavior.
 */
export function setApiBaseUrlOverrideForTests(url: string | undefined): void {
	apiBaseUrlOverride = url;
}

export async function getApiBaseUrlForContext(context: NodeContext): Promise<string> {
	if (apiBaseUrlOverride) {
		return apiBaseUrlOverride;
	}
	const credentials = await context.getCredentials(getCredentialType(context));
	return getApiBaseUrlFromCredentials(credentials);
}

/**
 * Recognizes NodeApiError instances created by a different n8n-workflow module copy.
 */
export function isNodeApiError(error: unknown): error is NodeApiError {
	return error instanceof NodeApiError || (error instanceof Error && error.name === 'NodeApiError');
}

/**
 * Keep existing `NodeApiError`s unchanged so their message, description, and context are preserved.
 * Wrap other errors in a `NodeApiError`.
 */
export function toNodeApiError(
	node: INode,
	error: unknown,
	options: { itemIndex?: number } = {},
): NodeApiError {
	if (isNodeApiError(error)) {
		if (options.itemIndex !== undefined && error.context)
			error.context.itemIndex = options.itemIndex;
		return error;
	}
	return new NodeApiError(node, error as JsonObject, options);
}

function textFromErrorItem(item: unknown): string | undefined {
	if (typeof item === 'string' && item.length > 0) return item;
	if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
	const record = item as IDataObject;
	const message = record.message ?? record.msg;
	return typeof message === 'string' && message.length > 0 ? message : undefined;
}

function joinErrorItems(items: unknown[], firstOnly: boolean): string | undefined {
	const messages = items
		.map(textFromErrorItem)
		.filter((message): message is string => message !== undefined);
	if (messages.length === 0) return undefined;
	return firstOnly ? messages[0] : messages.join('; ');
}

/**
 * Message from an API error body, one of:
 * - `{ errors: [string | { message }] }`
 * - `{ details: [{ message }] }` or `{ detail: [{ msg }] }` for validation errors
 * - `{ error: { message, type, param, code } }` on OpenAI-compatible chat completions
 */
function messageFromApiBody(data: unknown, firstOnly = false): string | undefined {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
	const body = data as IDataObject;

	if (Array.isArray(body.errors)) {
		const message = joinErrorItems(body.errors, firstOnly);
		if (message) return message;
	}
	if (Array.isArray(body.details)) {
		const message = joinErrorItems(body.details, firstOnly);
		if (message) return message;
	}
	if (typeof body.detail === 'string' && body.detail.length > 0) return body.detail;
	if (Array.isArray(body.detail)) {
		const message = joinErrorItems(body.detail, firstOnly);
		if (message) return message;
	}

	const nested = body.error;
	if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
		const message = (nested as IDataObject).message;
		if (typeof message === 'string' && message.length > 0) return message;
	}
	return typeof body.message === 'string' && body.message.length > 0 ? body.message : undefined;
}

/** The response body n8n copied onto the error, or the raw HTTP response body. */
function apiErrorBody(error: unknown): unknown {
	if (!error || typeof error !== 'object') return undefined;
	const wrapped = (error as { context?: { data?: unknown } }).context?.data;
	if (wrapped && typeof wrapped === 'object') return wrapped;
	if (error instanceof Error) {
		return (error as { response?: { data?: unknown } }).response?.data;
	}
	return undefined;
}

/** Resources that can be denied independently of workspace access. */
const RESOURCE_PERMISSION_ENDPOINTS: ReadonlyArray<{ pattern: RegExp; resource: string }> = [
	{ pattern: /\/deployments(\/|$)/, resource: 'service' },
	{ pattern: /\/indexes(\/|$)/, resource: 'index' },
	{ pattern: /\/files(\/|$)/, resource: 'file' },
	{ pattern: /\/search_sessions(\/|$)/, resource: 'search session' },
];

/** Returns actionable guidance for API authentication and authorization failures. */
function describeApiAuthErrorHint(
	httpCode: string | null,
	endpoint: string,
	description?: string,
): string {
	const normalizedDescription = description?.toLowerCase() ?? '';
	const isUnauthorized = httpCode === '401' || normalizedDescription.includes('unauthorized');
	const isForbidden = httpCode === '403' || normalizedDescription.includes('forbidden');

	if (isUnauthorized) {
		return 'Check that the API key is valid, or reconnect the OAuth2 credential.';
	}
	if (isForbidden) {
		const gatedResource = RESOURCE_PERMISSION_ENDPOINTS.find(({ pattern }) =>
			pattern.test(endpoint),
		)?.resource;
		if (gatedResource) {
			return `This credential either can't access this workspace, or lacks permission for this ${gatedResource}. Check both in Haystack Enterprise Platform.`;
		}
		return "This credential doesn't have access to this workspace. Use a workspace-level key/user for it, or an org-wide one.";
	}
	return '';
}

/** Updates every error field rendered by n8n. */
function showErrorText(error: NodeApiError, text: string): void {
	error.message = text;
	error.description = text;
	if (Array.isArray(error.messages)) {
		error.messages.splice(0, error.messages.length, text);
	}
}

/** Call directly, not via `.call()`, so `fn`'s return type is preserved. */
async function withApiErrorWrapping<T>(
	context: NodeContext,
	endpoint: string,
	fn: () => Promise<T>,
	extractOptions: { firstErrorOnly?: boolean } = {},
): Promise<T> {
	try {
		return await fn();
	} catch (caught) {
		const description = messageFromApiBody(apiErrorBody(caught), extractOptions.firstErrorOnly);
		// Keep n8n's error. A new NodeApiError would replace the message with generic status text.
		const error = isNodeApiError(caught)
			? caught
			: new NodeApiError(
					context.getNode(),
					caught as JsonObject,
					description ? { message: description } : {},
				);

		const shown = describeApiAuthErrorHint(error.httpCode, endpoint, description) || description;
		if (shown) {
			showErrorText(error, shown);
		} else if (typeof error.message !== 'string' || error.message === '[object Object]') {
			error.message = 'The Haystack Enterprise API request failed.';
		}

		throw error;
	}
}

/** Organization picked on the node. API keys are bound to one organization and ignore it. */
export async function getOrganizationId(context: NodeContext): Promise<string | undefined> {
	if (getCredentialType(context) !== SIGN_IN_CREDENTIAL_NAME) return undefined;
	const organizationId = isLoadOptionsContext(context)
		? context.getNodeParameter('organizationId', '')
		: context.getNodeParameter('organizationId', 0, '');
	return typeof organizationId === 'string' && organizationId.trim()
		? organizationId.trim()
		: undefined;
}

/** Organization dropdown shown for OAuth2 sign-in, where one account can belong to several. */
export const organizationIdProperty: INodeProperties = {
	displayName: 'Organization Name or ID',
	name: 'organizationId',
	type: 'options',
	typeOptions: {
		loadOptionsMethod: 'getOrganizations',
		loadOptionsDependsOn: ['authentication'],
	},
	displayOptions: { show: { authentication: ['oAuth2'] } },
	default: '',
	description:
		'Select the organization to work in. An expression is evaluated once, for the first item. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

/** Lists the signed-in user's organizations. */
export async function loadOrganizationOptions(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	if (getCredentialType(context) !== SIGN_IN_CREDENTIAL_NAME) return [];

	const credentials = await context.getCredentials(SIGN_IN_CREDENTIAL_NAME);
	const origin = apiOriginWithoutVersionPath(getApiOriginFromCredentials(credentials));
	let response: unknown;
	try {
		response = await context.helpers.httpRequestWithAuthentication.call(
			context,
			SIGN_IN_CREDENTIAL_NAME,
			{ method: 'GET', url: `${origin}/api/v2/organizations`, json: true },
		);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), (error as Error).message);
	}

	const organizations = ((response as IDataObject | undefined)?.organizations ??
		[]) as IDataObject[];
	const options = organizations
		.filter((organization) => typeof organization.organization_id === 'string')
		.map((organization) => ({
			name:
				typeof organization.name === 'string' && organization.name
					? organization.name
					: (organization.organization_id as string),
			value: organization.organization_id as string,
		}));
	return options;
}

/** Sends an authenticated API request with shared URL and error handling. */
export async function apiRequest(
	this: NodeContext,
	method: IHttpRequestMethods,
	endpoint: string,
	options: Partial<IHttpRequestOptions> = {},
): Promise<unknown> {
	const apiBaseUrl = await getApiBaseUrlForContext(this);
	const organizationId = await getOrganizationId(this);
	const requestOptions: IHttpRequestOptions = {
		method,
		url: `${apiBaseUrl}${endpoint}`,
		json: true,
		...options,
		...(organizationId && {
			headers: { ...options.headers, 'X-Organization-ID': organizationId },
		}),
	};

	return withApiErrorWrapping(this, endpoint, () =>
		this.helpers.httpRequestWithAuthentication.call(this, getCredentialType(this), requestOptions),
	);
}

/**
 * Returns a token for clients without n8n authentication hooks. OAuth2 tokens are validated through
 * an authenticated request first; unconditional refresh could race when refresh tokens rotate.
 */
export async function resolveBearerToken(context: ISupplyDataFunctions): Promise<string> {
	if (getCredentialType(context) === CREDENTIAL_NAME) {
		const credentials = await context.getCredentials(CREDENTIAL_NAME);
		const apiKey = credentials.apiKey;
		if (typeof apiKey !== 'string' || apiKey === '') {
			throw new NodeOperationError(
				context.getNode(),
				'The Haystack Enterprise API credential is missing an API key.',
			);
		}
		return apiKey;
	}

	const credentialsBefore = await context.getCredentials(SIGN_IN_CREDENTIAL_NAME);
	if (!readAccessToken(credentialsBefore)) {
		throw new NodeOperationError(
			context.getNode(),
			'The Haystack Enterprise OAuth2 credential is not connected yet. Open the credential and click "Connect".',
		);
	}

	await apiRequest.call(context, 'GET', '/workspaces');

	const accessToken = readAccessToken(await context.getCredentials(SIGN_IN_CREDENTIAL_NAME));
	if (!accessToken) {
		throw new NodeOperationError(
			context.getNode(),
			'Failed to obtain an access token from the Haystack Enterprise OAuth2 credential. Reconnect the credential.',
		);
	}
	return accessToken;
}

function readAccessToken(credentials: IDataObject): string | undefined {
	const accessToken = (credentials.oauthTokenData as { access_token?: unknown } | undefined)
		?.access_token;
	return typeof accessToken === 'string' && accessToken !== '' ? accessToken : undefined;
}

/** Uses NodeOperationError so load-options failures remain readable across n8n's REST boundary. */
async function loadOptionsApiRequest(
	context: ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	options: Partial<IHttpRequestOptions> = {},
): Promise<unknown> {
	try {
		return await apiRequest.call(context, method, endpoint, options);
	} catch (error) {
		throw new NodeOperationError(context.getNode(), (error as Error).message);
	}
}

/**
 * Requests a raw SSE stream and response headers. Failed requests show the first API error while
 * retaining the full response in Error data.
 */
export async function apiRequestStream(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject,
): Promise<{ stream: NodeJS.ReadableStream; headers: IDataObject }> {
	return withApiErrorWrapping(
		this,
		endpoint,
		async () => {
			const apiBaseUrl = await getApiBaseUrlForContext(this);
			const organizationId = await getOrganizationId(this);
			const response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				getCredentialType(this),
				{
					method,
					url: `${apiBaseUrl}${endpoint}`,
					json: true,
					...(organizationId && { headers: { 'X-Organization-ID': organizationId } }),
					body,
					encoding: 'stream',
					returnFullResponse: true,
				},
			)) as { body: NodeJS.ReadableStream; headers: IDataObject };
			return { stream: response.body, headers: response.headers };
		},
		{ firstErrorOnly: true },
	);
}

/** Reads a response header case-insensitively and returns its first value. */
export function getResponseHeader(headers: IDataObject, name: string): string | undefined {
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
	const value = key ? headers[key] : undefined;
	if (typeof value === 'string') return value;
	if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
	return undefined;
}

/** Parses JSON data records from an SSE stream and ignores keep-alives or malformed records. */
export async function consumeSseStream(
	stream: NodeJS.ReadableStream,
	onEvent: (event: IDataObject) => void,
): Promise<void> {
	let buffer = '';

	const emitCompleteRecords = () => {
		let boundary = buffer.indexOf('\n\n');
		while (boundary !== -1) {
			const record = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);

			const data = record
				.split('\n')
				.filter((line) => line.startsWith('data:'))
				.map((line) => line.slice('data:'.length).trim())
				.join('\n');

			if (data) {
				try {
					onEvent(JSON.parse(data) as IDataObject);
				} catch {
					// Not a JSON data record (e.g. a keep-alive comment) — ignore.
				}
			}

			boundary = buffer.indexOf('\n\n');
		}
	};

	// Streaming decoder so a multibyte UTF-8 character split across chunks isn't corrupted.
	const decoder = new TextDecoder();

	await new Promise<void>((resolve, reject) => {
		stream.on('data', (chunk: Buffer | string) => {
			const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
			// Normalise after appending: a chunk boundary can split a \r\n pair.
			buffer = (buffer + text).replace(/\r\n/g, '\n');
			emitCompleteRecords();
		});
		stream.on('end', resolve);
		stream.on('error', reject);
	});
}

/** Message from a mid-stream SSE error event. `data` is the raw payload for Error data. */
export function extractStreamErrorDetail(error: IDataObject[string]): {
	message: string;
	data: IDataObject[string];
} {
	if (typeof error === 'string' && error.length > 0) {
		return { message: error, data: error };
	}
	const message = messageFromApiBody(error, true);
	return { message: message ?? 'The stream returned an unknown error', data: error };
}

const SERVICE_ACTIVATING_HTTP_CODE = '591';

/** Extracts the API's unwrapped workspace array. */
export function extractWorkspaceList(response: unknown): IDataObject[] {
	return Array.isArray(response) ? (response as IDataObject[]) : [];
}

export async function loadWorkspaceOptions(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const response = await loadOptionsApiRequest(context, 'GET', '/workspaces');

	return extractWorkspaceList(response)
		.filter((workspace) => typeof workspace.name === 'string')
		.map((workspace) => {
			const name = workspace.name as string;
			return { name: name.charAt(0).toUpperCase() + name.slice(1), value: name };
		});
}

/** Extracts items from the standard paginated response. */
export function extractPaginatedList(response: unknown): IDataObject[] {
	if (response && typeof response === 'object' && Array.isArray((response as IDataObject).data)) {
		return (response as IDataObject).data as IDataObject[];
	}
	return [];
}

/** Fetches one page or all pages from a numbered pagination endpoint. */
export async function fetchPaginatedResults<T>(
	context: IExecuteFunctions,
	endpoint: string,
	qs: IDataObject,
	returnAll: boolean,
	limit: number,
	extractList: (response: unknown) => T[],
): Promise<T[]> {
	if (!returnAll) {
		const response = await apiRequest.call(context, 'GET', endpoint, {
			qs: { ...qs, limit, page_number: 1 },
		});
		return extractList(response);
	}

	const items: T[] = [];
	let pageNumber = 1;
	let hasMore = true;
	while (hasMore) {
		const response = (await apiRequest.call(context, 'GET', endpoint, {
			qs: { ...qs, limit, page_number: pageNumber },
		})) as IDataObject;
		items.push(...extractList(response));
		hasMore = response.has_more === true;
		pageNumber += 1;
	}
	return items;
}

/** Uses cursor filters for one-page requests and numbered pagination otherwise. */
export async function fetchListWithCursorOrPaging<T>(
	context: IExecuteFunctions,
	endpoint: string,
	qs: IDataObject,
	returnAll: boolean,
	limit: number,
	filters: IDataObject,
	extractList: (response: unknown) => T[],
): Promise<T[]> {
	if (!returnAll && (filters.before || filters.after)) {
		const cursorQs: IDataObject = { ...qs, limit };
		// Cursor and page-number parameters are mutually exclusive.
		delete cursorQs.page_number;
		if (filters.before) cursorQs.before = filters.before;
		if (filters.after) cursorQs.after = filters.after;
		const response = await apiRequest.call(context, 'GET', endpoint, { qs: cursorQs });
		return extractList(response);
	}

	return fetchPaginatedResults(context, endpoint, qs, returnAll, limit, extractList);
}

/** Loads and maps options for a workspace-scoped resource. */
async function loadResourceOptions(
	context: ILoadOptionsFunctions,
	resourcePath: string,
	extractList: (response: unknown) => IDataObject[],
	toOption: (item: IDataObject) => INodePropertyOptions | undefined,
	qs: IDataObject = { limit: 100, page_number: 1 },
): Promise<INodePropertyOptions[]> {
	const workspaceName = context.getNodeParameter('workspaceName') as string;
	if (!workspaceName) {
		return [];
	}

	const response = await loadOptionsApiRequest(
		context,
		'GET',
		`/workspaces/${workspaceName}/${resourcePath}`,
		{
			qs,
		},
	);

	return extractList(response)
		.map(toOption)
		.filter((option): option is INodePropertyOptions => option !== undefined);
}

export async function loadDeploymentOptions(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return loadResourceOptions(context, 'deployments', extractPaginatedList, (deployment) => {
		if (typeof deployment.deployment_id !== 'string') return undefined;
		const name = typeof deployment.name === 'string' ? deployment.name : deployment.deployment_id;
		const status = typeof deployment.status === 'string' ? ` (${deployment.status})` : '';
		return { name: `${name}${status}`, value: deployment.deployment_id };
	});
}

/** Adds an empty option for showing values from all services. */
export async function loadDeploymentOptionsWithAllOption(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return [{ name: 'All Services', value: '' }, ...(await loadDeploymentOptions(context))];
}

export async function loadFileOptions(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return loadResourceOptions(
		context,
		'files',
		extractPaginatedList,
		(file) => {
			if (typeof file.file_id !== 'string') return undefined;
			const name = typeof file.name === 'string' ? file.name : file.file_id;
			return { name, value: file.file_id };
		},
		{ limit: 100 },
	);
}

export async function loadIndexOptions(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return loadResourceOptions(context, 'indexes', extractPaginatedList, (index) => {
		if (typeof index.name !== 'string') return undefined;
		const status = typeof index.desired_status === 'string' ? ` (${index.desired_status})` : '';
		return { name: `${index.name}${status}`, value: index.name };
	});
}

const INITIAL_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30000;
const RETRY_BACKOFF_FACTOR = 1.5;

/**
 * Retries `fn` with growing backoff on HTTP 591 (service being activated) for up to `maxWaitMs`,
 * then rethrows the original NodeApiError. Runs `fn` once when `enabled` is false.
 */
export async function withServiceActivationRetry<T>(
	this: IExecuteFunctions,
	fn: () => Promise<T>,
	enabled: boolean,
	maxWaitMs: number,
): Promise<T> {
	if (!enabled) {
		return fn();
	}

	const startedAt = Date.now();
	let delayMs = INITIAL_RETRY_DELAY_MS;

	for (;;) {
		try {
			return await fn();
		} catch (error) {
			const isServiceActivating =
				isNodeApiError(error) && error.httpCode === SERVICE_ACTIVATING_HTTP_CODE;
			const elapsedMs = Date.now() - startedAt;
			if (isServiceActivating && elapsedMs < maxWaitMs) {
				await sleep(Math.min(delayMs, maxWaitMs - elapsedMs));
				delayMs = Math.min(delayMs * RETRY_BACKOFF_FACTOR, MAX_RETRY_DELAY_MS);
				continue;
			}
			throw toNodeApiError(this.getNode(), error);
		}
	}
}

/** List endpoints keyed by `search_sessions` instead of `data`. */
export function extractSearchSessionList(response: unknown): IDataObject[] {
	if (
		response &&
		typeof response === 'object' &&
		Array.isArray((response as IDataObject).search_sessions)
	) {
		return (response as IDataObject).search_sessions as IDataObject[];
	}
	return [];
}

export async function createSearchSession(
	this: IExecuteFunctions,
	workspaceName: string,
	deploymentId: string,
	body: IDataObject = {},
): Promise<string> {
	const response = (await apiRequest.call(
		this,
		'POST',
		`/workspaces/${workspaceName}/deployments/${deploymentId}/search_sessions`,
		Object.keys(body).length > 0 ? { body } : {},
	)) as IDataObject;
	return response.search_session_id as string;
}

export async function loadSearchSessionOptions(
	context: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return loadResourceOptions(
		context,
		'search_sessions',
		extractSearchSessionList,
		(session) => {
			if (typeof session.search_session_id !== 'string') return undefined;
			const id = session.search_session_id;
			const title =
				typeof session.title === 'string' && session.title.trim() !== '' ? session.title : id;
			return { name: title, value: id };
		},
		// Only deployment-owned sessions, as in SearchSession's getAll().
		{ limit: 100, page_number: 1, filter: 'deployment_id ne null' },
	);
}

/** Splits a comma-separated parameter into trimmed, non-empty items. */
export function parseCommaSeparatedList(value: unknown): string[] {
	if (typeof value !== 'string' || value.trim() === '') {
		return [];
	}
	return value
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/** Parses Extra Parameters (JSON). Empty values yield {}. Drops `reservedKeys`. */
export function readAdditionalParameters(
	this: IExecuteFunctions | ISupplyDataFunctions,
	itemIndex: number,
	value: unknown,
	reservedKeys: readonly string[] = [],
): IDataObject {
	if (value === undefined || value === null || value === '') {
		return {};
	}
	let parsed: unknown = value;
	if (typeof value === 'string') {
		if (value.trim() === '') return {};
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new NodeOperationError(this.getNode(), '"Extra Parameters (JSON)" is not valid JSON', {
				itemIndex,
			});
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new NodeOperationError(
			this.getNode(),
			'"Extra Parameters (JSON)" must be a JSON object',
			{
				itemIndex,
			},
		);
	}
	const extras = { ...(parsed as IDataObject) };
	for (const key of reservedKeys) {
		delete extras[key];
	}
	return extras;
}

/** Parses a JSON string parameter, throwing a NodeOperationError naming the field if invalid. */
export function parseJsonField(
	this: IExecuteFunctions,
	itemIndex: number,
	fieldName: string,
	value: unknown,
): IDataObject | undefined {
	if (typeof value !== 'string' || value.trim() === '') {
		return undefined;
	}
	try {
		return JSON.parse(value) as IDataObject;
	} catch {
		throw new NodeOperationError(this.getNode(), `"${fieldName}" is not valid JSON`, { itemIndex });
	}
}
