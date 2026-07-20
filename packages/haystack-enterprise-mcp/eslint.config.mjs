import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

// This package isn't cloud-eligible (see the N8N_DEPLOYMENT_TYPE guard in the
// node, and "strict": false in package.json), so configWithoutCloudSupport
// omits the cloud-only no-restricted-imports/no-restricted-globals rules —
// unlike haystack-enterprise, `npm run lint` here can safely cover test/
// (which imports the vitest devDependency) in the same pass as nodes/ and
// credentials/, without a second, non-cloud config file.
export default [
	...configWithoutCloudSupport,
	{
		files: ['nodes/**/*.ts', 'test/**/*.ts'],
		rules: {
			// @modelcontextprotocol/sdk resolves client/index.js, client/streamableHttp.js and
			// types.js at build- and run-time via its package.json "./*" wildcard export
			// (verified with `n8n-node build` and `require.resolve`) — eslint-plugin-import-x's
			// resolver just doesn't follow that wildcard pattern.
			'import-x/no-unresolved': 'off',
		},
	},
	{
		files: ['package.json'],
		rules: {
			// This package is deliberately excluded from n8n Cloud (see the
			// N8N_DEPLOYMENT_TYPE guard in the node) and is never submitted for cloud
			// verification, so the cloud multi-tenant shared-runtime version-conflict
			// concern this rule guards against doesn't apply — a self-hosted install
			// via a real `npm install` resolves regular dependencies reliably (more
			// reliably than peerDependencies, which this rule's own suggested
			// alternative restricts to n8n-workflow/@n8n/ai-node-sdk only anyway).
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
			// n8n-core must be declared as a peer dependency (like n8n-workflow) so it
			// resolves to the exact same module instance n8n's own runtime uses -
			// StructuredToolkit's `instanceof` checks in HaystackEnterpriseMcp.node.ts
			// silently fail otherwise (classic dual-package hazard). This rule only
			// allowlists n8n-workflow/@n8n/ai-node-sdk because it's meant to prevent
			// cloud-eligible packages from doing this; same self-hosted-only rationale
			// as the no-runtime-dependencies exception above applies.
			'@n8n/community-nodes/valid-peer-dependencies': 'off',
		},
	},
];
