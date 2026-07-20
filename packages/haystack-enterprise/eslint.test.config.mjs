import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

// Separate from eslint.config.mjs (which must stay byte-identical to n8n's
// default template — n8n-node's strict-mode check, run as part of
// `n8n-node release`, verifies that). The cloud-eligible ruleset that file
// pulls in applies repo-wide with no test-file carve-out, and includes
// no-restricted-imports/no-restricted-globals — rules meant to keep the
// *published* node/credential code free of runtime dependencies for n8n
// Cloud, but which would just as happily flag `vitest`/`setImmediate` in
// test/**/*.ts, which are never published (see "files" in package.json).
// Lints test/ under the same non-cloud ruleset haystack-enterprise-mcp uses
// for everything, since cloud eligibility never applies to test code anyway.
export default configWithoutCloudSupport;
