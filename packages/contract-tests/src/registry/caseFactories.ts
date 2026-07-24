import type { ContractTestCase } from './types';

/**
 * Reusable UUID fixture for path/query params across the contract-test
 * suites (file IDs, search session IDs, before/after cursors, ...) — Prism
 * validates these against the spec's `format: uuid` constraint, so any
 * syntactically valid UUID works regardless of what it conceptually stands
 * for at each call site.
 */
export const CONTRACT_TEST_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

/**
 * `before`/`after` are mutually exclusive with `page_number` per the spec —
 * shared by every Get Many endpoint that supports both keyset-cursor and
 * offset pagination (Index, Search Session; File uses a different
 * after_value/after_file_id cursor shape, and Service has no spec entry
 * yet). Verifies each resource's getAll() bypasses the shared
 * page_number-based pagination helper for this case (see
 * fetchListWithCursorOrPaging in haystack-enterprise's utils.ts).
 */
export function cursorPaginationCases(endpointPath: string): ContractTestCase[] {
	return [
		{
			operation: 'getAll',
			description: `GET ${endpointPath} (with before cursor)`,
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { before: CONTRACT_TEST_UUID },
			},
		},
		{
			operation: 'getAll',
			description: `GET ${endpointPath} (with after cursor)`,
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { after: CONTRACT_TEST_UUID },
			},
		},
	];
}
