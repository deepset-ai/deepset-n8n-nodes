import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

const CREDENTIAL_NAME = 'haystackEnterpriseApi';
const PRODUCTION_API_BASE_URL = 'https://api.cloud.deepset.ai/api/v1';

let apiBaseUrlOverride: string | undefined;

/**
 * Test-only escape hatch — lets the contract-tests package point requests at
 * a local Prism mock or an ephemeral environment instead of production. Not
 * `process.env`-based deliberately: reading `process.env` directly here would
 * let any environment variable on the host process affect this cloud-eligible
 * package's requests, which is exactly what
 * `@n8n/community-nodes/no-restricted-globals` guards against. Only
 * `contract-tests` (a private, non-published dev package with no cloud
 * eligibility constraints) ever calls this, from its own `setupFiles` hook.
 */
export function setApiBaseUrlOverrideForTests(url: string | undefined): void {
	apiBaseUrlOverride = url;
}

export function getApiBaseUrl(): string {
	return apiBaseUrlOverride ?? PRODUCTION_API_BASE_URL;
}

/**
 * Haystack Enterprise's API reports errors as `{ "errors": string[] }` (and some
 * endpoints use FastAPI's default `{ "detail": ... }` shape), neither of
 * which `NodeApiError` recognizes out of the box — it only special-cases
 * `data.message` / `data.error.message`, then falls back to matching the
 * raw HTTP error's own top-level `.message` (e.g. "Request failed with
 * status code 500") first, since `message` sorts before `detail`/`errors`
 * in its key-priority list. That silently swallows the real API error.
 *
 * On top of that, `this.helpers.httpRequestWithAuthentication()` already
 * wraps the raw HTTP failure in its own `NodeApiError` before we ever see
 * it (see n8n-core's `authentication.ts`). The raw error's response body
 * does NOT survive on `.cause` — `ExecutionBaseError`'s class-field
 * declarations (`cause;` with no initializer) reset it to `undefined`
 * right after `super()` runs, clobbering the native `Error` cause the
 * constructor just set — but that same constructor separately copies the
 * response body onto `.context.data` before the clobbering happens, and
 * that assignment survives. So `.context.data` is the reliable path to
 * Haystack Enterprise's actual error body, not `.cause` or `.response`.
 */
function extractApiErrorDetail(error: unknown, options: { firstErrorOnly?: boolean } = {}): string | undefined {
	const wrappedData = error instanceof NodeApiError ? error.context?.data : undefined;
	const rawData =
		error instanceof Error ? (error as { response?: { data?: unknown } }).response?.data : undefined;

	for (const data of [wrappedData, rawData]) {
		if (!data || typeof data !== 'object') {
			continue;
		}

		const errors = (data as IDataObject).errors;
		if (Array.isArray(errors)) {
			const messages = errors.filter((message): message is string => typeof message === 'string');
			if (messages.length > 0) {
				return options.firstErrorOnly ? messages[0] : messages.join('; ');
			}
		}

		const detail = (data as IDataObject).detail;
		if (typeof detail === 'string') {
			return detail;
		}
		if (Array.isArray(detail)) {
			const messages = detail
				.map((item) => (item && typeof item === 'object' ? (item as IDataObject).msg : undefined))
				.filter((msg): msg is string => typeof msg === 'string');
			if (messages.length > 0) {
				return messages.join('; ');
			}
		}

		const message = (data as IDataObject).message;
		if (typeof message === 'string') {
			return message;
		}
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
 * Turns an authorization failure into a short, standalone hint — mirrors the
 * Haystack Enterprise MCP node's describeTransportErrorHint. Every
 * workspace-scoped dropdown (deployments, files, indexes, search sessions)
 * is populated from a workspace picker that lists every workspace in the
 * organization regardless of what the configured API key can actually
 * reach, so hitting 401/403 here almost always means a workspace-scoped key
 * was used with the wrong workspace, or the key itself is invalid.
 *
 * A 403 on one of RESOURCE_PERMISSION_ENDPOINTS is ambiguous in a second way
 * on top of that: the same key can see the workspace fine but still be
 * denied that specific resource — the generic workspace-access wording
 * would be actively misleading there, so those cases get a hint naming both
 * possibilities instead.
 *
 * `httpCode` isn't always reliable — NodeApiError resolves it by hunting for
 * a status-shaped key (statusCode/status/code/...) somewhere in the raw
 * error object, and that hunt can come up empty depending on exactly how
 * n8n's HTTP client shapes the failure. Haystack Enterprise's own error text ("Forbidden"
 * / "Unauthorized", from its `{ errors: [...] }` body) is a second, more
 * direct signal that doesn't depend on that lookup succeeding, so `description`
 * (already extracted from that body) is checked as a fallback classifier.
 *
 * Returns '' for anything else so callers surface that error as-is.
 */
function describeApiAuthErrorHint(httpCode: string | null, endpoint: string, description?: string): string {
	const normalizedDescription = description?.toLowerCase() ?? '';
	const isUnauthorized = httpCode === '401' || normalizedDescription.includes('unauthorized');
	const isForbidden = httpCode === '403' || normalizedDescription.includes('forbidden');

	if (isUnauthorized) {
		return 'Check that the API key in this credential is valid.';
	}
	if (isForbidden) {
		const gatedResource = RESOURCE_PERMISSION_ENDPOINTS.find(({ pattern }) => pattern.test(endpoint))?.resource;
		if (gatedResource) {
			return `This API key either can't access this workspace, or lacks permission for this ${gatedResource}. Check both in Haystack Enterprise Platform.`;
		}
		return "This API key doesn't have access to this workspace. Use a workspace-level key for it, or an org-wide key.";
	}
	return '';
}

/**
 * Runs `fn` (an authenticated HTTP call), normalizing any failure into a
 * NodeApiError with Haystack Enterprise's real error detail as its `.description`.
 * `httpRequestWithAuthentication()` already throws a NodeApiError itself, so
 * `.description` is set by mutating that instance in place — constructing a
 * new one instead would return the input verbatim (NodeApiError's
 * constructor is a no-op passthrough when given an existing NodeApiError,
 * ignoring any options passed in) while also silently dropping
 * `.context.data`, which n8n's UI renders as its own "Error data" section.
 *
 * Also normalizes `.message` to always be a real, useful string. Haystack Enterprise's
 * error bodies (e.g. a bare `{ errors: [...] }` with no top-level "message"
 * string) can end up assigned verbatim to NodeApiError's own `.message`
 * instead of a string — n8n's "problem loading the parameter options"
 * popover renders `.message` directly and string-coerces a stray object
 * into the literal text "[object Object]". That coercion can also have
 * already happened *upstream* of us — e.g. if the underlying HTTP client
 * itself does something like `new Error(body)` with an object `body`, the
 * native `Error` constructor stringifies it immediately, so by the time we
 * see it `.message` is already the real *string* "[object Object]", not an
 * object — a plain `typeof !== 'string'` check can't catch that. A
 * classified auth hint always replaces `.message` with real, actionable
 * text regardless; otherwise this falls back to the extracted description
 * (or a generic message) whenever `.message` is missing, non-string, or is
 * that exact literal.
 *
 * Takes `context` as a plain parameter rather than a `this` parameter so
 * callers can invoke it directly (`withApiErrorWrapping(this, endpoint, fn)`)
 * instead of via `.call()`, which would erase `fn`'s generic return type to
 * `unknown`. `endpoint` is threaded through purely so describeApiAuthErrorHint
 * can tell a "Service" (deployments) call apart from any other resource.
 */
async function withApiErrorWrapping<T>(
	context: IExecuteFunctions | ILoadOptionsFunctions,
	endpoint: string,
	fn: () => Promise<T>,
	extractOptions: { firstErrorOnly?: boolean } = {},
): Promise<T> {
	try {
		return await fn();
	} catch (caught) {
		const description = extractApiErrorDetail(caught, extractOptions);
		const error =
			caught instanceof NodeApiError
				? caught
				: new NodeApiError(context.getNode(), caught as JsonObject, description ? { description } : {});

		if (caught instanceof NodeApiError && description) {
			error.description = description;
		}

		const authHint = describeApiAuthErrorHint(error.httpCode, endpoint, description);
		if (authHint) {
			error.message = authHint;
		} else if (typeof error.message !== 'string' || error.message === '[object Object]') {
			error.message = description ?? 'The Haystack Enterprise API request failed.';
		}

		throw error;
	}
}

/**
 * Thin wrapper around httpRequestWithAuthentication so every resource calls the
 * Haystack Enterprise API the same way (base URL, credential, error wrapping).
 */
export async function apiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	options: Partial<IHttpRequestOptions> = {},
): Promise<unknown> {
	const requestOptions: IHttpRequestOptions = {
		method,
		url: `${getApiBaseUrl()}${endpoint}`,
		json: true,
		...options,
	};

	return withApiErrorWrapping(this, endpoint, () =>
		this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_NAME, requestOptions),
	);
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
 * Uses `firstErrorOnly` (rather than apiRequest()'s join-all-messages
 * description) so the NodeApiError's description surfaces a single readable
 * sentence for the search-stream/chat-stream operations — the full `errors`
 * array is still available in `.context.data` for n8n's "Error data" section.
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
			const response = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_NAME, {
				method,
				url: `${getApiBaseUrl()}${endpoint}`,
				json: true,
				body,
				encoding: 'stream',
				returnFullResponse: true,
			})) as { body: NodeJS.ReadableStream; headers: IDataObject };
			return { stream: response.body, headers: response.headers };
		},
		{ firstErrorOnly: true },
	);
}

/**
 * Response headers come back with whatever casing the HTTP client normalized
 * them to, so look up `name`
 * case-insensitively rather than assuming lowercase.
 */
export function getResponseHeader(headers: IDataObject, name: string): string | undefined {
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
	const value = key ? headers[key] : undefined;
	return typeof value === 'string' ? value : undefined;
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

/**
 * A mid-stream SSE `error` event's `error` field arrives either as a plain
 * string or as Haystack Enterprise's `{ errors: string[] }` shape (see
 * extractApiErrorDetail() above) — never both, and not always the latter, so
 * this falls back to a generic message when neither shape yields one. `data`
 * is whatever raw payload was passed in, for callers to attach to
 * `NodeApiError`/`NodeOperationError`'s `.context.data` (n8n's "Error data"
 * section) so the full event is still visible even when the message had to
 * fall back.
 */
export function extractStreamErrorDetail(
	error: IDataObject[string],
): { message: string; data: IDataObject[string] } {
	if (typeof error === 'string') {
		return { message: error, data: error };
	}

	if (error && typeof error === 'object') {
		const errors = (error as IDataObject).errors;
		if (Array.isArray(errors)) {
			const message = errors.find((item): item is string => typeof item === 'string');
			if (message) {
				return { message, data: error };
			}
		}
	}

	return { message: 'The stream returned an unknown error', data: error };
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
		const response = await apiRequest.call(context, 'GET', endpoint, { qs: { ...qs, limit, page_number: 1 } });
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

	const response = await loadOptionsApiRequest(context, 'GET', `/workspaces/${workspaceName}/${resourcePath}`, {
		qs,
	});

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

export async function loadFileOptions(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
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

export async function loadIndexOptions(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
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
 * throws a fresh NodeApiError for whatever it last failed with. Runs `fn`
 * exactly once when `enabled` is false.
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
			const isServiceActivating = error instanceof NodeApiError && error.httpCode === SERVICE_ACTIVATING_HTTP_CODE;
			const elapsedMs = Date.now() - startedAt;
			if (isServiceActivating && elapsedMs < maxWaitMs) {
				await sleep(Math.min(delayMs, maxWaitMs - elapsedMs));
				delayMs = Math.min(delayMs * RETRY_BACKOFF_FACTOR, MAX_RETRY_DELAY_MS);
				continue;
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
	if (response && typeof response === 'object' && Array.isArray((response as IDataObject).search_sessions)) {
		return (response as IDataObject).search_sessions as IDataObject[];
	}
	return [];
}

export async function createSearchSession(
	this: IExecuteFunctions,
	workspaceName: string,
	deploymentId: string,
): Promise<string> {
	const response = (await apiRequest.call(
		this,
		'POST',
		`/workspaces/${workspaceName}/deployments/${deploymentId}/search_sessions`,
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
			const title = typeof session.title === 'string' && session.title.trim() !== '' ? session.title : id;
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
