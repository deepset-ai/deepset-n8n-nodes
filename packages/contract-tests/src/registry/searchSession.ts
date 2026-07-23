import { executeSearchSession } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/searchSession/SearchSession.execute';
import type { ContractResourceSuite } from './types';

/**
 * TODO:`SearchSession create` isn't in this registry — it first fetches the deployment
 * (`fetchDeployment` in utils.ts, GET `/deployments/{id}`) to resolve its
 * source pipeline before creating the session, and that lookup hits the same
 * undocumented `/deployments` path as the Service resource (see
 * `service.ts`). Add it back once Service is published, or once that lookup
 * has its own confirmed stand-in.
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
		{
			// `before`/`after` are UUID-formatted and mutually exclusive with
			// page_number per the spec — SearchSession.execute.ts's getAll()
			// bypasses the shared page_number-based pagination helper for this
			// case, so this also validates that branch actually omits page_number
			// (see the analogous Index cases in `indexResource.ts`).
			operation: 'getAll',
			description: 'GET /search_sessions (with before cursor)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { before: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
			},
		},
		{
			operation: 'getAll',
			description: 'GET /search_sessions (with after cursor)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { after: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
			},
		},
		{
			operation: 'delete',
			description: 'DELETE /search_sessions/{search_session_id}',
			params: {
				workspaceName: 'contract-test-workspace',
				searchSessionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
			},
		},
	],
};
