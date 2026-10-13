import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

// Test-only lint config: the cloud-eligible rules in eslint.config.mjs (which must stay n8n's default template) would flag vitest/setImmediate in unpublished test code.
export default configWithoutCloudSupport;
