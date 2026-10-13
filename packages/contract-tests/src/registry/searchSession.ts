import type { ContractResourceSuite } from './types';

import { executeSearchSession } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/searchSession/SearchSession.execute';
import { CONTRACT_TEST_UUID, cursorPaginationCases } from './caseFactories';

export const searchSessionSuite: ContractResourceSuite = {
	resource: 'searchSession',
	handler: executeSearchSession,
	cases: [
		{
			operation: 'create',
			description: 'POST /deployments/{deployment_id}/search_sessions',
			params: {
				workspaceName: 'contract-test-workspace',
				deploymentId: CONTRACT_TEST_UUID,
			},
		},
		{
			// No optional query params.
			operation: 'getAll',
			description: 'GET /search_sessions (no optional query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
			},
		},
		{
			operation: 'getAll',
			description: 'GET /search_sessions (with filter query param)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { odataFilter: "title eq 'contract-test'" },
			},
		},
		...cursorPaginationCases('/search_sessions'),
		{
			operation: 'delete',
			description: 'DELETE /search_sessions/{search_session_id}',
			params: {
				workspaceName: 'contract-test-workspace',
				searchSessionId: CONTRACT_TEST_UUID,
			},
		},
	],
};
