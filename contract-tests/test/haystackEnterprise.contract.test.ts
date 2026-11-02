import { describe, expect, it } from 'vitest';

import { buildContractTestContext } from '../src/context';
import { contractResourceSuites } from '../src/registry';

describe.each(contractResourceSuites)('$resource', ({ handler, cases }) => {
	it.each(cases)('$operation — $description', async ({ operation, params }) => {
		const context = buildContractTestContext({ params });

		const result = await handler.call(context, operation, 0);

		expect(Array.isArray(result)).toBe(true);
	});
});
