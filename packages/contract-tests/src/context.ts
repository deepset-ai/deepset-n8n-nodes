import type { IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { Readable } from 'node:stream';

export interface ContractTestContextOptions {
	/** Flat node parameter map used by the contract-test context. */
	params: Record<string, unknown>;
}

function toErrorLike(status: number, data: unknown): Error {
	return Object.assign(new Error(`Request failed with status code ${status}`), {
		response: { status, data },
	});
}

/**
 * Real `httpRequestWithAuthentication` that sends an actual HTTP request.
 * Supports JSON bodies, `FormData`, `encoding: 'stream'` and `returnFullResponse`;
 * not `encoding: 'arraybuffer'` (see `src/registry/file.ts`).
 */
async function realHttpRequestWithAuthentication(
	requestOptions: IHttpRequestOptions,
): Promise<unknown> {
	const url = new URL(requestOptions.url);
	for (const [key, value] of Object.entries(requestOptions.qs ?? {})) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, String(value));
		}
	}

	// Pass FormData to fetch as-is so it sets its own multipart boundary header.
	const isFormData = requestOptions.body instanceof FormData;
	const hasBody = requestOptions.body !== undefined;

	// Prism only requires that a bearer token is present, not its value.
	const response = await fetch(url, {
		method: requestOptions.method,
		headers: {
			authorization: 'Bearer contract-test-token',
			...(hasBody && !isFormData ? { 'content-type': 'application/json' } : {}),
		},
		body: isFormData
			? (requestOptions.body as FormData)
			: hasBody
				? JSON.stringify(requestOptions.body)
				: undefined,
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
		const stream = Readable.fromWeb(response.body as never);
		if (requestOptions.returnFullResponse) {
			return { body: stream, headers: Object.fromEntries(response.headers.entries()) };
		}
		return stream;
	}

	const text = await response.text();
	const body: unknown = text ? JSON.parse(text) : undefined;
	if (requestOptions.returnFullResponse) {
		return {
			body,
			headers: Object.fromEntries(response.headers.entries()),
			statusCode: response.status,
		};
	}
	return body;
}

/** Builds an `IExecuteFunctions`-like context backed by a real HTTP layer. */
export function buildContractTestContext({
	params,
}: ContractTestContextOptions): IExecuteFunctions {
	// Must be a plain function: callers invoke it via `Function.prototype.call`.
	const httpRequestWithAuthentication = (
		_credentialName: string,
		requestOptions: IHttpRequestOptions,
	) => realHttpRequestWithAuthentication(requestOptions);

	return {
		getNode: () => ({ name: 'Haystack Enterprise AI (contract test)' }),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			Object.prototype.hasOwnProperty.call(params, name)
				? params[name]
				: name === 'authentication'
					? 'apiKey'
					: fallback,
		helpers: { httpRequestWithAuthentication },
		isStreaming: () => false,
		sendChunk: () => undefined,
	} as unknown as IExecuteFunctions;
}
