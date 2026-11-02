import type { ContractTestCase } from './types';

/** Shared UUID fixture; Prism only checks the spec's `format: uuid`. */
export const CONTRACT_TEST_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

/** `before`/`after` cursor cases (mutually exclusive with `page_number`) for Get Many endpoints. */
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
