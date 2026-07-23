import { executeIndex } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/index/Index.execute';
import type { ContractResourceSuite } from './types';

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
		{
			// `before`/`after` are UUID-formatted and mutually exclusive with
			// page_number per the spec — Index.execute.ts's getAll() bypasses the
			// shared page_number-based pagination helper for this case, so this
			// also validates that branch actually omits page_number.
			operation: 'getAll',
			description: 'GET /indexes (with before cursor)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { before: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
			},
		},
		{
			operation: 'getAll',
			description: 'GET /indexes (with after cursor)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { after: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
			},
		},
	],
};
