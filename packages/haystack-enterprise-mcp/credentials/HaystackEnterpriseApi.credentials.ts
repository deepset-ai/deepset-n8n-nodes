import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// Kept in sync by hand with packages/haystack-enterprise/credentials/HaystackEnterpriseApi.credentials.ts.
// Both packages intentionally register a credential type with the same `name` so a user who
// installs both only has to configure one "Haystack Enterprise API" credential. They can't share
// this file via a real npm dependency without losing haystack-enterprise's n8n Cloud eligibility
// (cloud-eligible packages may not declare runtime dependencies). Unify into one shared package
// once haystack-enterprise-mcp is also cloud-eligible.
export class HaystackEnterpriseApi implements ICredentialType {
	name = 'haystackEnterpriseApi';

	displayName = 'Haystack Enterprise API';

	icon = 'file:../nodes/HaystackEnterpriseMcp/haystack-enterprise-electric-blue.svg' as const;

	documentationUrl = 'https://docs.cloud.deepset.ai/docs/generate-api-key';

	properties: INodeProperties[] = [
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: 'https://api.cloud.deepset.ai',
			placeholder: 'https://api.cloud.deepset.ai',
			description:
				'The Haystack Enterprise API origin. Use the default for the hosted Haystack Enterprise Platform; for self-hosted or dev environments, enter your instance API origin (for example <code>https://haystack.example.com</code>).',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Haystack Enterprise <a href="https://docs.cloud.deepset.ai/docs/generate-api-key/" target="_blank" rel="noopener noreferrer">API key</a>. Generate one in Haystack Enterprise Platform under Settings → API Keys.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{ ((($credentials.serverUrl || "https://api.cloud.deepset.ai").trim().replace(/\\/+$/,"")) || "https://api.cloud.deepset.ai") }}/api/v1',
			url: '/workspaces',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Invalid API key. Check your key in Haystack Enterprise Platform under Settings → API Keys.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message: 'Access denied. The API key may not have permission to list workspaces.',
				},
			},
		],
	};
}
