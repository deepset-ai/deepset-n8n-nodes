import { describe, expect, it } from 'vitest';
import { executeSearchSession } from '../../nodes/HaystackEnterprise/resources/searchSession/SearchSession.execute';
import { createExecuteContext } from './testHelpers';

interface ContextOptions {
	params: Record<string, unknown>;
	createSessionResponse?: Record<string, unknown>;
	listResponse?: Record<string, unknown>;
}

function createContext({ params, createSessionResponse, listResponse }: ContextOptions) {
	return createExecuteContext(params, async (...args: unknown[]) => {
		const requestOptions = args[1] as { method: string; url: string; qs?: Record<string, unknown> };
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
	});
}

describe('executeSearchSession — create', () => {
	it('creates a session directly against the selected service (deployment)', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { workspaceName: 'ws', deploymentId: 'dep-1' },
			createSessionResponse: { search_session_id: 'created-session' },
		});

		const result = await executeSearchSession.call(context, 'create', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				method: 'POST',
				url: expect.stringContaining('/workspaces/ws/deployments/dep-1/search_sessions'),
			}),
		);
		expect(result).toEqual([{ json: { search_session_id: 'created-session' } }]);
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
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{ workspaceName: 'ws', returnAll: true, filters: {} },
			async () => {
				call += 1;
				if (call === 1) {
					return { search_sessions: [{ search_session_id: 'a' }], has_more: true, total: 2 };
				}
				return { search_sessions: [{ search_session_id: 'b' }], has_more: false, total: 2 };
			},
		);

		const result = await executeSearchSession.call(context, 'getAll', 0);

		expect(result).toEqual([{ json: { search_session_id: 'a' } }, { json: { search_session_id: 'b' } }]);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});

	it('always scopes to deployment-owned sessions, even with no user filter', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { workspaceName: 'ws', returnAll: false, limit: 50, filters: {} },
			listResponse: { search_sessions: [], has_more: false, total: 0 },
		});

		await executeSearchSession.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({ qs: expect.objectContaining({ filter: 'deployment_id ne null' }) }),
		);
	});

	it('scopes to one service instead of the deployment-owned baseline when a service is selected', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { workspaceName: 'ws', returnAll: false, limit: 50, deploymentId: 'dep-1', filters: {} },
			listResponse: { search_sessions: [], has_more: false, total: 0 },
		});

		await executeSearchSession.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({ qs: expect.objectContaining({ filter: "deployment_id eq 'dep-1'" }) }),
		);
	});

	it("escapes a single quote in the selected service's ID for the OData filter", async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { workspaceName: 'ws', returnAll: false, limit: 50, deploymentId: "dep-1'", filters: {} },
			listResponse: { search_sessions: [], has_more: false, total: 0 },
		});

		await executeSearchSession.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({ qs: expect.objectContaining({ filter: "deployment_id eq 'dep-1'''" }) }),
		);
	});

	it('ANDs the user OData filter onto the deployment-owned scoping', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { workspaceName: 'ws', returnAll: false, limit: 50, filters: { odataFilter: "title eq 'Support chat'" } },
			listResponse: { search_sessions: [], has_more: false, total: 0 },
		});

		await executeSearchSession.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				qs: expect.objectContaining({ filter: "deployment_id ne null and (title eq 'Support chat')" }),
			}),
		);
	});

	it('queries by the before cursor instead of page_number when Return All is off', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { workspaceName: 'ws', returnAll: false, limit: 50, filters: { before: 'session-cursor-1' } },
			listResponse: { search_sessions: [{ search_session_id: 'a' }], has_more: false, total: 1 },
		});

		const result = await executeSearchSession.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [string, { qs: Record<string, unknown> }];
		expect(options.qs).toMatchObject({ before: 'session-cursor-1' });
		expect(options.qs).not.toHaveProperty('page_number');
		expect(result).toEqual([{ json: { search_session_id: 'a' } }]);
	});

	it('queries by the after cursor instead of page_number when Return All is off', async () => {
		const { context, httpRequestWithAuthentication } = createContext({
			params: { workspaceName: 'ws', returnAll: false, limit: 50, filters: { after: 'session-cursor-2' } },
			listResponse: { search_sessions: [{ search_session_id: 'b' }], has_more: false, total: 1 },
		});

		await executeSearchSession.call(context, 'getAll', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [string, { qs: Record<string, unknown> }];
		expect(options.qs).toMatchObject({ after: 'session-cursor-2' });
		expect(options.qs).not.toHaveProperty('page_number');
	});

	it('ignores before/after and uses page_number pagination when Return All is on', async () => {
		let call = 0;
		const { context, httpRequestWithAuthentication } = createExecuteContext(
			{ workspaceName: 'ws', returnAll: true, filters: { before: 'session-cursor-1' } },
			async () => {
				call += 1;
				if (call === 1) {
					return { search_sessions: [{ search_session_id: 'a' }], has_more: true, total: 2 };
				}
				return { search_sessions: [{ search_session_id: 'b' }], has_more: false, total: 2 };
			},
		);

		await executeSearchSession.call(context, 'getAll', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [string, { qs: Record<string, unknown> }];
		expect(options.qs).toHaveProperty('page_number');
		expect(options.qs).not.toHaveProperty('before');
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
