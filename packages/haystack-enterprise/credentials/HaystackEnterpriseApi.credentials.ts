import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

// Kept in sync by hand with packages/haystack-enterprise-mcp/credentials/HaystackEnterpriseApi.credentials.ts.
// Both packages intentionally register a credential type with the same `name` so a user who
// installs both only has to configure one "Haystack Enterprise API" credential. They can't share
// this file via a real npm dependency without losing this package's n8n Cloud eligibility
// (cloud-eligible packages may not declare runtime dependencies). Unify into one shared package
// once haystack-enterprise-mcp is also cloud-eligible.
export class HaystackEnterpriseApi implements ICredentialType {
	name = 'haystackEnterpriseApi';

	displayName = 'Haystack Enterprise API';

	icon = 'file:../nodes/HaystackEnterprise/haystack-enterprise-electric-blue.svg' as const;

	documentationUrl = 'https://docs.cloud.deepset.ai/docs/generate-api-key';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your Haystack Enterprise <a href="https://docs.cloud.deepset.ai/docs/generate-api-key/" target="_blank">API key</a>. Generate one in Haystack Enterprise Platform under Settings → API Keys.',
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
			baseURL: 'https://api.cloud.deepset.ai/api/v1',
			url: '/workspaces',
			method: 'GET',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message: 'Invalid API key. Check your key in Haystack Enterprise Platform under Settings → API Keys.',
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
