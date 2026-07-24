import { executeIndex } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/index/Index.execute';
import type { ContractResourceSuite } from './types';
import { cursorPaginationCases } from './caseFactories';

export const indexSuite: ContractResourceSuite = {
	resource: 'index',
	handler: executeIndex,
	cases: [
		{
			operation: 'get',
			description: 'GET /indexes/{index_name}',
			params: {
				workspaceName: 'contract-test-workspace',
				indexName: 'contract-test-index',
			},
		},
		{
			// Every optional query param (filter/select/field/order/before/after)
			// omitted — the most common real-world call shape, since most users
			// won't touch Filters/Sort at all. Only limit + page_number are sent.
			operation: 'getAll',
			description: 'GET /indexes (no optional query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
			},
		},
		{
			// Also exercises the `filter`/`select`/`field`/`order` query params
			// (not just pagination) — `field`/`order` have enum constraints in the
			// spec, so a wrong value here would actually fail against Prism.
			operation: 'getAll',
			description: 'GET /indexes (with filter + select + sort query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { odataFilter: "name eq 'contract-test'", select: 'name, created_by/user_id' },
				sort: { field: 'name', order: 'ASC' },
			},
		},
		...cursorPaginationCases('/indexes'),
	],
};
