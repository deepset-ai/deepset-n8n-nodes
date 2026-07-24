import { Readable } from 'node:stream';
import type { IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';

export interface ContractTestContextOptions {
	/** Flat parameter map — `getNodeParameter(name, _itemIndex, fallback)` reads from this, falling back like real n8n does when the parameter is absent. */
	params: Record<string, unknown>;
}

function toErrorLike(status: number, data: unknown): Error {
	return Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, data },
	});
}

/**
 * Real (non-mocked) `httpRequestWithAuthentication` — sends an actual HTTP
 * request instead of the `vi.fn()` stub the repo's unit tests use, since
 * contract tests need the node's real request to actually reach Prism (or an
 * ephemeral environment) for validation. Handles only what
 * `haystack-enterprise/nodes/HaystackEnterprise/utils.ts`'s `apiRequest`/
 * `apiRequestStream` actually send: JSON method/url/qs/body, `FormData` bodies
 * (File's `upload`), and the `encoding: 'stream'` case for the *-stream
 * endpoints. Does NOT handle `encoding: 'arraybuffer'`/`returnFullResponse`
 * (File's `get`) — see the comment on that case in `src/registry/file.ts` for
 * why that's not just a missing feature here.
 */
async function realHttpRequestWithAuthentication(requestOptions: IHttpRequestOptions): Promise<unknown> {
	const url = new URL(requestOptions.url);
	for (const [key, value] of Object.entries(requestOptions.qs ?? {})) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, String(value));
		}
	}

	// A FormData body (File's `upload`) must be passed to fetch as-is — fetch
	// sets its own `multipart/form-data; boundary=...` header for it, which
	// JSON.stringify-ing the body and forcing `content-type: application/json`
	// (the JSON-body case below) would silently replace with an empty `{}`.
	const isFormData = requestOptions.body instanceof FormData;
	const hasBody = requestOptions.body !== undefined;

	// The real credential injects a bearer token here; Prism doesn't check the
	// token's value, only that the request satisfies the spec's declared
	// `HTTPBearer` security scheme at all (it 401s an entirely bare request).
	const response = await fetch(url, {
		method: requestOptions.method,
		headers: {
			authorization: 'Bearer contract-test-token',
			...(hasBody && !isFormData ? { 'content-type': 'application/json' } : {}),
		},
		body: isFormData ? (requestOptions.body as FormData) : hasBody ? JSON.stringify(requestOptions.body) : undefined,
	});

	if (!response.ok) {
		const rawBody = await response.text();
		let parsedBody: unknown = rawBody;
		try {
			parsedBody = JSON.parse(rawBody);
		} catch {
			// Not JSON — surface the raw text as-is.
		}
		throw toErrorLike(response.status, parsedBody);
	}

	if (requestOptions.encoding === 'stream') {
		if (!response.body) {
			throw new Error('Expected a response body to stream, got none.');
		}
		return Readable.fromWeb(response.body as never);
	}

	const text = await response.text();
	return text ? JSON.parse(text) : undefined;
}

/**
 * Builds an `IExecuteFunctions`-like context for contract tests — same
 * `getNodeParameter` convention as the repo's existing unit tests (e.g.
 * `test/HaystackEnterprise/Service.execute.test.ts`), but with a real HTTP
 * layer instead of a mocked one.
 */
export function buildContractTestContext({ params }: ContractTestContextOptions): IExecuteFunctions {
	// `utils.ts` calls this as `this.helpers.httpRequestWithAuthentication.call(this, credentialName, requestOptions)`
	// — i.e. `Function.prototype.call` on the function itself, so this must be
	// a plain function (matching the real n8n helper's shape and the repo's
	// existing unit-test stubs), not an object with its own `.call` method.
	const httpRequestWithAuthentication = (_credentialName: string, requestOptions: IHttpRequestOptions) =>
		realHttpRequestWithAuthentication(requestOptions);

	return {
		getNode: () => ({ name: 'Haystack Enterprise AI (contract test)' }),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback,
		helpers: { httpRequestWithAuthentication },
		isStreaming: () => false,
		sendChunk: () => undefined,
	} as unknown as IExecuteFunctions;
}
