import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	ISupplyDataFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

const CREDENTIAL_NAME = 'haystackEnterpriseApi';
const OAUTH2_CREDENTIAL_NAME = 'haystackEnterpriseOAuth2Api';
export const DEFAULT_API_ORIGIN = 'https://api.cloud.deepset.ai';

/**
 * ILoadOptionsFunctions.getNodeParameter() takes (name, fallback) — there's only ever one "item"
 * in a loadOptions call — while IExecuteFunctions' takes (name, itemIndex, fallback). Calling the
 * former with the latter's argument order would silently pass the item index as the fallback.
 * getCurrentNodeParameter() only exists on the load-options context, so it's the discriminator.
 */
type NodeContext = IExecuteFunctions | ILoadOptionsFunctions | ISupplyDataFunctions;

function isLoadOptionsContext(context: NodeContext): context is ILoadOptionsFunctions {
	return typeof (context as Partial<ILoadOptionsFunctions>).getCurrentNodeParameter === 'function';
}

/**
 * The nodes offer API Key and OAuth2 as alternate credential types, picked via the
 * "Authentication" node parameter — this resolves that choice to the credential type name
 * httpRequestWithAuthentication() / getCredentials() should use. Read at item index 0:
 * "Authentication" is a static top-level dropdown, not a per-item expression. Falls back to API
 * Key for workflows saved before the parameter existed.
 */
export function getCredentialType(context: NodeContext): string {
	const authentication = isLoadOptionsContext(context)
		? context.getNodeParameter('authentication', 'apiKey')
		: context.getNodeParameter('authentication', 0, 'apiKey');
	return authentication === 'oAuth2' ? OAUTH2_CREDENTIAL_NAME : CREDENTIAL_NAME;
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

/** Strips a trailing `/api/v1` or `/api/v2` so versioned base URLs are not doubled. */
function apiOriginWithoutVersionPath(origin: string): string {
	const withoutVersion = normalizeApiOrigin(origin).replace(/\/api\/v[12]$/i, '');
	return withoutVersion === '' ? DEFAULT_API_ORIGIN : withoutVersion;
}

export function getApiBaseUrlV1FromOrigin(origin: string): string {
	return `${apiOriginWithoutVersionPath(origin)}/api/v1`;
}

export function getApiBaseUrlFromCredentials(credentials: IDataObject): string {
	return getApiBaseUrlV1FromOrigin(getApiOriginFromCredentials(credentials));
}

/**
 * Test-only escape hatch for targeting local Prism mocks or ephemeral environments.
 * Deliberately avoids `process.env` so host environment variables cannot affect
 * requests from this cloud-eligible package (`@n8n/community-nodes/no-restricted-globals`).
 */
export function setApiBaseUrlOverrideForTests(url: string | undefined): void {
	apiBaseUrlOverride = url;
}

/**
 * Both credential types carry a `serverUrl`: the API key credential's is the API origin; the
 * OAuth2 credential's is n8n's DCR "Server URL" (the protected resource, i.e. `<origin>/api/v1`).
 * getApiBaseUrlFromCredentials() strips a trailing `/api/v1` so either form yields the same base.
 */
export async function getApiBaseUrlForContext(context: NodeContext): Promise<string> {
	if (apiBaseUrlOverride) {
		return apiBaseUrlOverride;
	}
	const credentials = await context.getCredentials(getCredentialType(context));
	return getApiBaseUrlFromCredentials(credentials);
}

/**
 * n8n and this package load different copies of n8n-workflow, so instanceof
 * misses the NodeApiError that httpRequestWithAuthentication throws.
 */
export function isNodeApiError(error: unknown): error is NodeApiError {
	return error instanceof NodeApiError || (error instanceof Error && error.name === 'NodeApiError');
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
 * Message from a hub API error body. application_utils.py returns one of:
 * - `{ errors: [string | { message }] }` for a normal HTTPException
 * - `{ details: [{ message }] }` for HTTPValidationException, or FastAPI's `{ detail: [{ msg }] }`
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

/**
 * Resources Haystack Enterprise gates independently of workspace access — hitting these
 * endpoints with a workspace-scoped key can 403 even though that same key
 * sees the workspace itself just fine, because the key also needs its own
 * permission on the specific service, index, file, or search session.
 */
const RESOURCE_PERMISSION_ENDPOINTS: ReadonlyArray<{ pattern: RegExp; resource: string }> = [
	{ pattern: /\/deployments(\/|$)/, resource: 'service' },
	{ pattern: /\/indexes(\/|$)/, resource: 'index' },
	{ pattern: /\/files(\/|$)/, resource: 'file' },
	{ pattern: /\/search_sessions(\/|$)/, resource: 'search session' },
];

/**
 * Hint for 401/403. The workspace picker lists every workspace, so these are
 * usually a bad API key or a key without access to this workspace or resource.
 * The status code is sometimes missing, so the body text is a fallback.
 */
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

/**
 * "Full message" in the node error view is `error.messages`, not `.message`.
 * Replace that list so it shows the API text instead of "Request failed with status code …".
 */
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

/**
 * Thin wrapper around httpRequestWithAuthentication so every resource calls the
 * Haystack Enterprise API the same way (base URL, credential, error wrapping).
 */
export async function apiRequest(
	this: NodeContext,
	method: IHttpRequestMethods,
	endpoint: string,
	options: Partial<IHttpRequestOptions> = {},
): Promise<unknown> {
	const apiBaseUrl = await getApiBaseUrlForContext(this);
	const requestOptions: IHttpRequestOptions = {
		method,
		url: `${apiBaseUrl}${endpoint}`,
		json: true,
		...options,
	};

	return withApiErrorWrapping(this, endpoint, () =>
		this.helpers.httpRequestWithAuthentication.call(this, getCredentialType(this), requestOptions),
	);
}

/**
 * The raw bearer token for code paths that can't go through httpRequestWithAuthentication() — the
 * Chat Model sub-node hands a static key to @n8n/ai-node-sdk, which has no auth hook of its own.
 *
 * For OAuth2 the stored access token may have expired and nothing downstream can refresh it, so
 * one cheap authenticated request is made first: on a 401 n8n refreshes the token and persists it
 * (see n8n-core's requestOAuth2()), and getCredentials() then returns the fresh one. Deliberately
 * not an unconditional refreshOAuth2Token(): refresh tokens rotate, so refreshing on every run
 * would race between concurrent executions sharing the credential.
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

	const credentialsBefore = await context.getCredentials(OAUTH2_CREDENTIAL_NAME);
	if (!readAccessToken(credentialsBefore)) {
		throw new NodeOperationError(
			context.getNode(),
			'The Haystack Enterprise OAuth2 credential is not connected yet. Open the credential and click "Connect".',
		);
	}

	await apiRequest.call(context, 'GET', '/workspaces');

	const accessToken = readAccessToken(await context.getCredentials(OAUTH2_CREDENTIAL_NAME));
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

/**
 * Like apiRequest(), but for use from a `loadOptions` method specifically.
 *
 * n8n's own REST client special-cases any error whose serialized `.name` is
 * `"NodeApiError"` (apiRequest()'s failure mode): instead of wrapping it in
 * a proper `Error` instance like it does for every other error shape, it
 * re-throws the raw parsed JSON body as-is. The "problem loading the
 * parameter options" popover only knows how to read `.message` off a real
 * `instanceof Error`, so it falls through to string-coercing that raw
 * object — producing the literal, useless text "[object Object]" — no
 * matter how good `.message` actually is. `NodeOperationError` doesn't hit
 * that special case, so re-throwing as one here (reusing the same message
 * apiRequest() already computed) is what actually gets it displayed.
 */
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
 * Like apiRequest(), but for the *-stream endpoints: requests the response as
 * a raw Node.js stream instead of buffering and JSON-parsing the body, so the
 * caller can read Server-Sent Events off it as they arrive. Also returns the
 * response headers (`returnFullResponse: true`) — chat-stream reports the
 * search session ID via an `X-Search-Session-Id` header when one wasn't
 * passed in the request, since it's created automatically in that case.
 *
 * A failed stream request shows the first API error; the full body stays in Error data.
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
			const response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				getCredentialType(this),
				{
					method,
					url: `${apiBaseUrl}${endpoint}`,
					json: true,
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

/**
 * Response headers come back with whatever casing the HTTP client normalized
 * them to, so look up `name` case-insensitively rather than assuming
 * lowercase. A repeated header (e.g. Node's `IncomingHttpHeaders`) can arrive
 * as a `string[]` instead of a `string` — take the first value in that case
 * rather than dropping it.
 */
export function getResponseHeader(headers: IDataObject, name: string): string | undefined {
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
	const value = key ? headers[key] : undefined;
	if (typeof value === 'string') return value;
	if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
	return undefined;
}

/**
 * Haystack Enterprise's *-stream endpoints respond with Server-Sent Events: `data: {...}`
 * lines, one JSON event per record, records separated by a blank line. Reads
 * the stream to completion, calling `onEvent` with each event's parsed JSON
 * payload in arrival order. Records without a `data:` line (e.g. SSE
 * keep-alive comments) or with unparseable JSON are silently skipped.
 *
 * Consumes via `data`/`end`/`error` events rather than `for await...of` —
 * `NodeJS.ReadableStream` (the ambient @types/node interface, used here to
 * avoid an `import ... from 'node:stream'`, which n8n's cloud-compatibility
 * lint rule rejects) isn't typed as async-iterable, even though the real
 * stream instance is at runtime.
 */
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

	await new Promise<void>((resolve, reject) => {
		stream.on('data', (chunk: Buffer | string) => {
			buffer += chunk.toString().replace(/\r\n/g, '\n');
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

/**
 * GET /api/v1/workspaces responds with a bare array of workspace objects
 * (each with a `name`, `workspace_id`, `languages`, etc.) — not wrapped in
 * an envelope object.
 */
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

/**
 * List/paginated endpoints (deployments, files, ...) respond with
 * `{ data: [...], has_more: boolean, total: number }`.
 */
export function extractPaginatedList(response: unknown): IDataObject[] {
	if (response && typeof response === 'object' && Array.isArray((response as IDataObject).data)) {
		return (response as IDataObject).data as IDataObject[];
	}
	return [];
}

/**
 * Runs the "Get Many" pattern shared identically by the Service, Index, and
 * Search Session resources: a `page_number`/`has_more` paginated GET endpoint
 * that either returns a single page (Return All off, using the user's chosen
 * `limit`) or walks every page (Return All on, 100 per page) and flattens the
 * results. `extractList` reads the response's list field, which differs per
 * endpoint (`data` vs `search_sessions`).
 *
 * Takes `context` as a plain parameter rather than a `this` parameter — same
 * rationale as withApiErrorWrapping() above: calling a generic function via
 * `.call()` erases its type parameter to `unknown`, so `extractList`'s own
 * element type wouldn't survive into the returned array.
 */
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

/**
 * Wraps fetchPaginatedResults() with the before/after cursor bypass shared
 * identically by the Index, Service, and Search Session resources'
 * `getAll()`: `before`/`after` are mutually exclusive with `page_number` per
 * the API ("To use this option, clear the page_number parameter first"), so
 * a single direct GET is used instead of the page_number-based pagination
 * loop whenever either is set. Only applies when Return All is off — Return
 * All always manages its own page_number cursor internally.
 */
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
		// before/after and page_number are mutually exclusive per the API — strip
		// page_number defensively in case a future caller's `qs` already has one.
		delete cursorQs.page_number;
		if (filters.before) cursorQs.before = filters.before;
		if (filters.after) cursorQs.after = filters.after;
		const response = await apiRequest.call(context, 'GET', endpoint, { qs: cursorQs });
		return extractList(response);
	}

	return fetchPaginatedResults(context, endpoint, qs, returnAll, limit, extractList);
}

/**
 * Runs the "populate a workspace-scoped dropdown" pattern shared identically
 * by the Deployment/File/Index/Search Session loadOptions methods: resolve
 * the selected workspace (returning no options if none is selected yet), GET
 * a listing endpoint under it, then map each list entry to a dropdown option
 * — `toOption` returns `undefined` to skip entries missing their ID field.
 */
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

/**
 * Same as loadDeploymentOptions(), but with a leading pseudo-option (empty value) for
 * clearing the field back to "no service selected" to show values for all services
 */
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
 * Retries `fn` with growing backoff while it fails with HTTP 591 (the service
 * is inactive and is being activated), for up to `maxWaitMs` in total, then
 * rethrows that failure unchanged when it is already a NodeApiError, so its
 * message is not replaced by the generic status text. Runs `fn` exactly
 * once when `enabled` is false.
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
			if (isNodeApiError(error)) {
				// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- already a NodeApiError; constructing a new one replaces .message with the generic status text
				throw error;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject);
		}
	}
}

/**
 * List/paginated endpoints keyed by a name other than `data` (search sessions
 * respond with `{ search_sessions: [...], has_more, total }`).
 */
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
		// Same deployment-only scoping as SearchSession's getAll() — see the comment there.
		{ limit: 100, page_number: 1, filter: 'deployment_id ne null' },
	);
}

/**
 * Splits a user-supplied comma-separated string parameter (e.g. "File Names")
 * into trimmed, non-empty items. Shared by File's `deleteMany` and Service's
 * stream operations' `files` field.
 */
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

/**
 * Parses a user-supplied JSON string parameter (e.g. a `type: 'json'` field),
 * throwing a NodeOperationError that points at the offending field if invalid.
 */
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
