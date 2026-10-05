import type { ContractResourceSuite } from './types';

import { executeService } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/service/Service.execute';

/**
 * TODO: Service isn't published in the OpenAPI spec yet — there's no
 * `/deployments` path in the spec at all, so Prism has nothing to validate a
 * request against. Add test cases for `chat`/`chatStream`/`get`/
 * `getAll` once Service has a documented spec entry.
 *
 * `getAll`'s query params (`group_label`, OData `filter`, `field`/`order`,
 * `before`/`after`) are implemented and unit-tested (Service.execute.test.ts)
 * against haystack-hub-api's actual `deployment_controller.py:list_deployments`
 * — confirmed from source, not guessed — but still can't be contract-tested
 * here until that endpoint is published (unlike chat/chatStream,
 * `getAll` has no Pipeline equivalent to remap onto in the meantime).
 *
 * Once this has cases again, also remove the now-unneeded empty-suite filter
 * in `test/haystackEnterprise.contract.test.ts`.
 */
export const serviceSuite: ContractResourceSuite = {
	resource: 'service',
	handler: executeService,
	cases: [],
};
