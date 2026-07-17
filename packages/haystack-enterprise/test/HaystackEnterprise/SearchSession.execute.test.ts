import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import { executeSearchSession } from '../../nodes/HaystackEnterprise/resources/searchSession/SearchSession.execute';

interface ContextOptions {
	params: Record<string, unknown>;
	deploymentResponse?: Record<string, unknown>;
	createSessionResponse?: Record<string, unknown>;
	listResponse?: Record<string, unknown>;
}

function createContext({ params, deploymentResponse, createSessionResponse, listResponse }: ContextOptions) {
	const httpRequestWithAuthentication = vi.fn(
		async (_credentialType: string, requestOptions: { method: string; url: string }) => {
			if (requestOptions.method === 'GET' && /\/deployments\/[^/]+$/.test(requestOptions.url)) {
				return deploymentResponse ?? {};
			}
			if (requestOptions.method === 'POST' && requestOptions.url.endsWith('/search_sessions')) {
				return createSessionResponse ?? { search_session_id: 'created-session' };
			}
			if (requestOptions.method === 'GET' && requestOptions.url.includes('/search_sessions')) {
				return listResponse ?? { search_sessions: [], has_more: false, total: 0 };
			}
			if (requestOptions.method === 'DELETE') {
				return {};
			}
			throw new Error(`Unexpected request: ${requestOptions.method} ${requestOptions.url}`);
		},
	);

	const context = {
		helpers: { httpRequestWithAuthentication },
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
	} as unknown as IExecuteFunctions;

	return { context, httpRequestWithAuthentication };
}

describe('executeSearchSession — create', () => {
	it('resolves the pipeline ID from the selected service and creates a session', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { workspaceName: 'ws', deploymentId: 'dep-1' },
			deploymentResponse: { active_revision: { source_pipeline_id: 'pipeline-1' } },
			createSessionResponse: { search_session_id: 'created-session' },
		});

		const result = await executeSearchSession.call(context, 'create', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				method: 'POST',
				url: expect.stringContaining('/search_sessions'),
				body: { pipeline_id: 'pipeline-1' },
			}),
		);
		expect(result).toEqual([{ json: { search_session_id: 'created-session' } }]);
	});

	it('throws a clear error when the service has no active revision', async () => {
		const { context } = createContext({
			params: { workspaceName: 'ws', deploymentId: 'dep-1' },
			deploymentResponse: {},
		});

		await expect(executeSearchSession.call(context, 'create', 0)).rejects.toThrow(/active revision/);
	});
});

describe('executeSearchSession — get many', () => {
	it('returns each session as its own item', async () => {
		const { context } = createContext({
			params: { workspaceName: 'ws', returnAll: false, limit: 50, filters: {} },
			listResponse: {
				search_sessions: [{ search_session_id: 'a' }, { search_session_id: 'b' }],
				has_more: false,
				total: 2,
			},
		});

		const result = await executeSearchSession.call(context, 'getAll', 0);

		expect(result).toEqual([{ json: { search_session_id: 'a' } }, { json: { search_session_id: 'b' } }]);
	});

	it('pages through results when Return All is enabled', async () => {
		let call = 0;
		const httpRequestWithAuthentication = vi.fn(async () => {
			call += 1;
			if (call === 1) {
				return { search_sessions: [{ search_session_id: 'a' }], has_more: true, total: 2 };
			}
			return { search_sessions: [{ search_session_id: 'b' }], has_more: false, total: 2 };
		});
		const context = {
			helpers: { httpRequestWithAuthentication },
			getNode: () => ({ name: 'Haystack Enterprise AI' }),
			getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) => {
				const params: Record<string, unknown> = { workspaceName: 'ws', returnAll: true, filters: {} };
				return name in params ? params[name] : fallback;
			},
		} as unknown as IExecuteFunctions;

		const result = await executeSearchSession.call(context, 'getAll', 0);

		expect(result).toEqual([{ json: { search_session_id: 'a' } }, { json: { search_session_id: 'b' } }]);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});
});

describe('executeSearchSession — delete', () => {
	it('deletes the given session and reports success', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { workspaceName: 'ws', searchSessionId: 'session-1' },
		});

		const result = await executeSearchSession.call(context, 'delete', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({ method: 'DELETE', url: expect.stringContaining('/search_sessions/session-1') }),
		);
		expect(result).toEqual([{ json: { searchSessionId: 'session-1', success: true } }]);
	});
});
