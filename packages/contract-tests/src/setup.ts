import { setApiBaseUrlOverrideForTests } from '../../haystack-enterprise/nodes/HaystackEnterprise/utils';

// `globalSetup.ts` runs in a separate process/context and hands off the
// resolved base URL via `process.env` (the standard way Vitest propagates
// state from globalSetup into each worker) — this file runs *inside* the
// worker and turns that into the in-memory override haystack-enterprise's
// utils.ts actually reads, so the shipped package never touches `process.env`
// itself (see the comment on `setApiBaseUrlOverrideForTests`).
setApiBaseUrlOverrideForTests(process.env.HAYSTACK_API_BASE_URL_OVERRIDE);
