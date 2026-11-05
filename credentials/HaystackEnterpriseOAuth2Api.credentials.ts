import type { ICredentialType, INodeProperties } from 'n8n-workflow';

// Keep in sync with credentials/HaystackEnterpriseOAuth2Api.credentials.ts in https://github.com/deepset-ai/n8n-nodes-haystack-enterprise-mcp.
//
// Uses n8n's standard `oAuth2Api` flow with a manually configured client. Dynamic Client
// Registration is not yet available for community nodes; add it back once it is.
export class HaystackEnterpriseOAuth2Api implements ICredentialType {
	name = 'haystackEnterpriseOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Haystack Enterprise OAuth2 API';

	icon = 'file:../nodes/HaystackEnterprise/haystack-enterprise-electric-blue.svg' as const;

	documentationUrl = 'https://github.com/deepset-ai/n8n-nodes-haystack-enterprise#credentials';

	properties: INodeProperties[] = [
		{
			// The node also derives API request URLs from this value.
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: 'https://api.cloud.deepset.ai',
			required: true,
			description:
				'The Haystack Enterprise API origin (for example, https://api.cloud.deepset.ai).',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'string',
			default: 'openid profile email offline_access',
			description: 'The OAuth2 scopes requested when using a manually configured client.',
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: false,
			description: 'Optional for public PKCE clients; required for confidential OAuth2 clients.',
		},
		{
			displayName: 'Organization ID (Optional)',
			name: 'organizationId',
			type: 'string',
			default: '',
			description:
				'Only required if you belong to multiple organizations. Used for every request made with this credential.',
		},
	];
}
