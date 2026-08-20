import { executeSearchSession } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/searchSession/SearchSession.execute';
import type { ContractResourceSuite } from './types';
import { CONTRACT_TEST_UUID, cursorPaginationCases } from './caseFactories';

/**
 * TODO: `SearchSession create` isn't in this registry — it now calls the
 * deployment-scoped `POST /workspaces/{workspace}/deployments/{deployment_id}/`
 * `search_sessions` endpoint, which lives under the same undocumented
 * `/deployments` path as the Service resource (see `service.ts`): the whole
 * deployment router is registered with `include_in_schema=False` in
 * haystack-hub-api, so Prism has no spec entry to validate a request
 * against. Add it back once that router is published.
 */
export const searchSessionSuite: ContractResourceSuite = {
	resource: 'searchSession',
	handler: executeSearchSession,
	cases: [
		{
			// No optional query params at all — the most common real-world call
			// shape, since most users won't touch Filters.
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
