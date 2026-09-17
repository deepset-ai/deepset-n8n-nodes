import { describe, expect, it } from 'vitest';

import { buildContractTestContext } from '../src/context';
import { contractResourceSuites } from '../src/registry';

// TODO(remove once Service has cases again — see `src/registry/service.ts`):
// filters out resources with no cases yet (currently just Service) since an
// empty `it.each([])` would otherwise fail the suite with "No test found",
// which isn't a real failure. Once Service is filled back in there are no
// empty suites left, so drop this filter rather than leave it in place.
describe.each(contractResourceSuites.filter((suite) => suite.cases.length > 0))(
	'$resource',
	({ handler, cases }) => {
		it.each(cases)('$operation — $description', async ({ operation, params }) => {
			const context = buildContractTestContext({ params });

			const result = await handler.call(context, operation, 0);

			expect(Array.isArray(result)).toBe(true);
		});
	},
);
