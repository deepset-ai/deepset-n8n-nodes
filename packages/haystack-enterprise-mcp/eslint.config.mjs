import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

// Not cloud-eligible, so the cloud-only restricted-imports/globals rules are omitted
// and lint can cover test/ in the same pass.
export default [
	...configWithoutCloudSupport,
	{
		files: ['nodes/**/*.ts', 'test/**/*.ts'],
		rules: {
			// @modelcontextprotocol/sdk subpaths resolve via a "./*" wildcard export that
			// eslint-plugin-import-x's resolver doesn't follow.
			'import-x/no-unresolved': 'off',
		},
	},
	{
		files: ['package.json'],
		rules: {
			// Self-hosted only (excluded from n8n Cloud), so the cloud shared-runtime
			// version-conflict concern behind this rule doesn't apply.
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
			// n8n-core must be a peer dependency so it resolves to n8n's own module instance;
			// otherwise StructuredToolkit `instanceof` checks fail (dual-package hazard).
			'@n8n/community-nodes/valid-peer-dependencies': 'off',
		},
	},
];
