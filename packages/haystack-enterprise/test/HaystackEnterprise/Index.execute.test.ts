import { describe, expect, it, vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';
import { executeIndex } from '../../nodes/HaystackEnterprise/resources/index/Index.execute';

function createContext(params: Record<string, unknown>, response: Record<string, unknown>) {
	const httpRequestWithAuthentication = vi.fn(async () => response);

	const context = {
		helpers: { httpRequestWithAuthentication },
		getNode: () => ({ name: 'Haystack Enterprise AI' }),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
	} as unknown as IExecuteFunctions;

	return { context, httpRequestWithAuthentication };
}

describe('executeIndex — get', () => {
	it('fetches the index by name from the selected workspace', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', indexName: 'my-index' },
			{ pipeline_index_id: 'idx-1', name: 'my-index', desired_status: 'DEPLOYED' },
		);

		const result = await executeIndex.call(context, 'get', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({ method: 'GET', url: expect.stringContaining('/workspaces/ws/indexes/my-index') }),
		);
		expect(result).toEqual([{ json: { pipeline_index_id: 'idx-1', name: 'my-index', desired_status: 'DEPLOYED' } }]);
	});
});

describe('executeIndex — get many', () => {
	it('returns each index as its own item', async () => {
		const { context } = createContext(
			{ workspaceName: 'ws', returnAll: false, limit: 50, filters: {}, sort: {} },
			{ data: [{ name: 'a' }, { name: 'b' }], has_more: false, total: 2 },
		);

		const result = await executeIndex.call(context, 'getAll', 0);

		expect(result).toEqual([{ json: { name: 'a' } }, { json: { name: 'b' } }]);
	});

	it('pages through results when Return All is enabled', async () => {
		let call = 0;
		const httpRequestWithAuthentication = vi.fn(async () => {
			call += 1;
			if (call === 1) {
				return { data: [{ name: 'a' }], has_more: true, total: 2 };
			}
			return { data: [{ name: 'b' }], has_more: false, total: 2 };
		});
		const context = {
			helpers: { httpRequestWithAuthentication },
			getNode: () => ({ name: 'Haystack Enterprise AI' }),
			getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) => {
				const params: Record<string, unknown> = { workspaceName: 'ws', returnAll: true, filters: {}, sort: {} };
				return name in params ? params[name] : fallback;
			},
		} as unknown as IExecuteFunctions;

		const result = await executeIndex.call(context, 'getAll', 0);

		expect(result).toEqual([{ json: { name: 'a' } }, { json: { name: 'b' } }]);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});

	it('passes the OData filter and sort options as query params', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				returnAll: false,
				limit: 50,
				filters: { odataFilter: "desired_status eq 'DEPLOYED'" },
				sort: { field: 'name', order: 'ASC' },
			},
			{ data: [], has_more: false, total: 0 },
		);

		await executeIndex.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				qs: expect.objectContaining({
					filter: "desired_status eq 'DEPLOYED'",
					field: 'name',
					order: 'ASC',
				}),
			}),
		);
	});
});
