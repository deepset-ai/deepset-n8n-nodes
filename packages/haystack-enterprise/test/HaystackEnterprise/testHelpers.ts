import { vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';

/**
 * Minimal fake IExecuteFunctions context shared by the resource execute()
 * test suites: `getNodeParameter` reads from `params`, falling back to the
 * caller's own default; `httpRequestWithAuthentication` is any mock
 * implementation, so callers can express a static response, a dynamic
 * per-call responder (e.g. pagination), or one that throws. `extraHelpers`
 * merges onto `context.helpers` (e.g. `assertBinaryData`/`prepareBinaryData`);
 * `extraContext` merges onto the context itself (e.g. `isStreaming`/
 * `sendChunk`).
 */
export function createExecuteContext(
	params: Record<string, unknown>,
	httpRequestWithAuthentication: (...args: unknown[]) => unknown,
	extraHelpers: Record<string, unknown> = {},
	extraContext: Record<string, unknown> = {},
) {
	const httpRequestMock = vi.fn(httpRequestWithAuthentication);

	const context = {
		helpers: { httpRequestWithAuthentication: httpRequestMock, ...extraHelpers },
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback,
		...extraContext,
	} as unknown as IExecuteFunctions;

	return { context, httpRequestWithAuthentication: httpRequestMock };
}

/**
 * Minimal stand-in for a Node.js Readable in 'data'/'end'/'error' mode — all
 * consumeSseStream()/apiRequestStream() actually rely on.
 */
export class FakeStream {
	private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

	on(event: string, callback: (...args: unknown[]) => void): this {
		(this.listeners[event] ??= []).push(callback);
		return this;
	}

	emit(event: string, ...args: unknown[]): void {
		for (const callback of this.listeners[event] ?? []) {
			callback(...args);
		}
	}
}
