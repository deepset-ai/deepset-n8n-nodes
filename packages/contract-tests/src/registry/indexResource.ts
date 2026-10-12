import type { ContractResourceSuite } from './types';

import { executeIndex } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/index/Index.execute';
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
			// No optional query params; only limit + page_number are sent.
			operation: 'getAll',
			description: 'GET /indexes (no optional query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
			},
		},
		{
			// `field`/`order` are enums in the spec, so invalid values fail against Prism.
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
