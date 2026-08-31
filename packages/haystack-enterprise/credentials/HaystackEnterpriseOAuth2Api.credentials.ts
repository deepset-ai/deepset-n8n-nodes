import type { ICredentialType, INodeProperties } from 'n8n-workflow';

// Kept in sync by hand with
// packages/haystack-enterprise-mcp/credentials/HaystackEnterpriseOAuth2Api.credentials.ts.
// See HaystackEnterpriseApi.credentials.ts for why these can't be shared via a real npm
// dependency yet.
//
// Extends n8n's built-in `oAuth2Api` rather than implementing OAuth2/DCR ourselves — with
// `useDynamicClientRegistration` on, n8n discovers the authorization server from `serverUrl`'s
// `/.well-known/oauth-protected-resource` (RFC 9728), dynamically registers itself against that
// server's `registration_endpoint` (RFC 7591), and stores the resulting client ID/secret
// automatically. `authUrl`/`accessTokenUrl`/`clientId`/`clientSecret`/`scope` all stay inherited
// from `oAuth2Api` (hidden while DCR is on) so a user can still switch DCR off and fill them in
// by hand against a manually created OAuth2 client. See the deepset-n8n-nodes README/AGENTS for
// the Authentik-side setup this depends on.
export class HaystackEnterpriseOAuth2Api implements ICredentialType {
	name = 'haystackEnterpriseOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Haystack Enterprise OAuth2 API';

	icon = 'file:../nodes/HaystackEnterprise/haystack-enterprise-electric-blue.svg' as const;

	documentationUrl = 'https://docs.cloud.deepset.ai/docs/generate-api-key';

	properties: INodeProperties[] = [
		{
			displayName: 'Use Dynamic Client Registration',
			name: 'useDynamicClientRegistration',
			type: 'boolean',
			default: true,
			description:
				'Whether to register this n8n instance as an OAuth2 client automatically (RFC 7591) instead of pasting in a client ID/secret created by hand. Requires your identity provider to support Dynamic Client Registration (e.g. Authentik 2026.8+).',
		},
		{
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: 'https://api.cloud.deepset.ai/api/v1',
			required: true,
			displayOptions: { show: { useDynamicClientRegistration: [true] } },
			description:
				"The Haystack Enterprise API base URL. n8n discovers its authorization server and registers itself from this URL's /.well-known/oauth-protected-resource.",
		},
	];
}
