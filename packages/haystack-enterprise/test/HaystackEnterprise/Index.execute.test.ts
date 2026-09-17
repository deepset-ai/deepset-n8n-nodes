import { describe, expect, it } from 'vitest';

import { executeIndex } from '../../nodes/HaystackEnterprise/resources/index/Index.execute';
import { createExecuteContext as createContext } from './testHelpers';

describe('executeIndex — get', () => {
	it('fetches the index by name from the selected workspace', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', indexName: 'my-index' },
			async () => ({ pipeline_index_id: 'idx-1', name: 'my-index', desired_status: 'DEPLOYED' }),
		);

		const result = await executeIndex.call(context, 'get', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				method: 'GET',
				url: expect.stringContaining('/workspaces/ws/indexes/my-index'),
			}),
		);
		expect(result).toEqual([
			{ json: { pipeline_index_id: 'idx-1', name: 'my-index', desired_status: 'DEPLOYED' } },
		]);
	});
});

describe('executeIndex — get many', () => {
	it('returns each index as its own item', async () => {
		const { context } = createContext(
			{ workspaceName: 'ws', returnAll: false, limit: 50, filters: {}, sort: {} },
			async () => ({ data: [{ name: 'a' }, { name: 'b' }], has_more: false, total: 2 }),
		);

		const result = await executeIndex.call(context, 'getAll', 0);

		expect(result).toEqual([{ json: { name: 'a' } }, { json: { name: 'b' } }]);
	});

	it('pages through results when Return All is enabled', async () => {
		let call = 0;
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', returnAll: true, filters: {}, sort: {} },
			async () => {
				call += 1;
				if (call === 1) {
					return { data: [{ name: 'a' }], has_more: true, total: 2 };
				}
				return { data: [{ name: 'b' }], has_more: false, total: 2 };
			},
		);

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
			async () => ({ data: [], has_more: false, total: 0 }),
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

	it('passes the select option as a query param', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				returnAll: false,
				limit: 50,
				filters: { select: 'name, created_by/user_id' },
				sort: {},
			},
			async () => ({ data: [], has_more: false, total: 0 }),
		);

		await executeIndex.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				qs: expect.objectContaining({ select: 'name, created_by/user_id' }),
			}),
		);
	});

	it('queries by the before cursor instead of page_number when Return All is off', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				returnAll: false,
				limit: 50,
				filters: { before: 'idx-cursor-1' },
				sort: {},
			},
			async () => ({ data: [{ name: 'a' }], has_more: false, total: 1 }),
		);

		const result = await executeIndex.call(context, 'getAll', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [
			string,
			{ qs: Record<string, unknown> },
		];
		expect(options.qs).toMatchObject({ before: 'idx-cursor-1' });
		expect(options.qs).not.toHaveProperty('page_number');
		expect(result).toEqual([{ json: { name: 'a' } }]);
	});

	it('queries by the after cursor instead of page_number when Return All is off', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				returnAll: false,
				limit: 50,
				filters: { after: 'idx-cursor-2' },
				sort: {},
			},
			async () => ({ data: [{ name: 'b' }], has_more: false, total: 1 }),
		);

		await executeIndex.call(context, 'getAll', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [
			string,
			{ qs: Record<string, unknown> },
		];
		expect(options.qs).toMatchObject({ after: 'idx-cursor-2' });
		expect(options.qs).not.toHaveProperty('page_number');
	});

	it('ignores before/after and uses page_number pagination when Return All is on', async () => {
		let call = 0;
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				returnAll: true,
				filters: { before: 'idx-cursor-1' },
				sort: {},
			},
			async () => {
				call += 1;
				if (call === 1) {
					return { data: [{ name: 'a' }], has_more: true, total: 2 };
				}
				return { data: [{ name: 'b' }], has_more: false, total: 2 };
			},
		);

		await executeIndex.call(context, 'getAll', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as unknown as [
			string,
			{ qs: Record<string, unknown> },
		];
		expect(options.qs).toHaveProperty('page_number');
		expect(options.qs).not.toHaveProperty('before');
	});
});
