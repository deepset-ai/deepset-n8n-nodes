import { setApiBaseUrlOverrideForTests } from '../../haystack-enterprise/nodes/HaystackEnterprise/utils';

// globalSetup hands the base URL over via `process.env`; apply it as the in-memory override here.
setApiBaseUrlOverrideForTests(process.env.HAYSTACK_API_BASE_URL_OVERRIDE);
