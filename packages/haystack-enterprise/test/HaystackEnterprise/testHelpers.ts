import type { IExecuteFunctions } from 'n8n-workflow';
import { vi } from 'vitest';

/** Minimal fake IExecuteFunctions: `getNodeParameter` reads `params`; `extraHelpers`/`extraContext` merge onto helpers/context. */
export function createExecuteContext(
	params: Record<string, unknown>,
	httpRequestWithAuthentication: (...args: unknown[]) => unknown,
	extraHelpers: Record<string, unknown> = {},
	extraContext: Record<string, unknown> = {},
	credentials: Record<string, unknown> = { apiKey: 'test-key' },
) {
	const httpRequestMock = vi.fn(httpRequestWithAuthentication);

	const context = {
		helpers: { httpRequestWithAuthentication: httpRequestMock, ...extraHelpers },
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback,
		getCredentials: async () => credentials,
		...extraContext,
	} as unknown as IExecuteFunctions;

	return { context, httpRequestWithAuthentication: httpRequestMock };
}

/** Minimal Readable stand-in for 'data'/'end'/'error' consumption. */
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
