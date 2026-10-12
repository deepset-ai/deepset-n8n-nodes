import type { ICredentialType, INodeProperties } from 'n8n-workflow';

// Keep in sync with packages/haystack-enterprise/credentials/HaystackEnterpriseOAuth2Api.credentials.ts.
//
// n8n's `oAuth2Api` handles discovery, DCR, PKCE, and token storage. Its manual OAuth2 fields
// remain available when DCR is disabled.
export class HaystackEnterpriseOAuth2Api implements ICredentialType {
	name = 'haystackEnterpriseOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Haystack Enterprise OAuth2 API';

	icon = 'file:../nodes/HaystackEnterpriseMcp/haystack-enterprise-electric-blue.svg' as const;

	documentationUrl =
		'https://github.com/deepset-ai/deepset-n8n-nodes/tree/main/packages/haystack-enterprise-mcp#credentials';

	properties: INodeProperties[] = [
		{
			displayName:
				'Click <b>Connect</b> below and sign in with your Haystack Enterprise account. n8n registers itself with Haystack Enterprise automatically — no client ID or secret to copy.',
			name: 'dynamicClientRegistrationNotice',
			type: 'notice',
			default: '',
			displayOptions: { show: { useDynamicClientRegistration: [true] } },
		},
		{
			// DCR is hidden and disabled by default in oAuth2Api.
			displayName: 'Use Dynamic Client Registration',
			name: 'useDynamicClientRegistration',
			type: 'boolean',
			default: true,
			description:
				'Whether to let n8n register itself as an OAuth2 client automatically (RFC 7591); turn this off to configure or reuse an OAuth2 client manually.',
		},
		{
			// The node also derives API request URLs from this value.
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: 'https://api.cloud.deepset.ai/api/v1',
			required: true,
			description:
				'The Haystack Enterprise API base URL, including /api/v1 (for example, https://api.cloud.deepset.ai/api/v1), used for API requests and OAuth2 authorization-server discovery and registration.',
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: false,
			displayOptions: { show: { useDynamicClientRegistration: [false] } },
			description: 'Optional for public PKCE clients; required for confidential OAuth2 clients.',
		},
	];
}
