import type { ICredentialType, INodeProperties } from 'n8n-workflow';

// Kept in sync by hand with
// packages/haystack-enterprise-mcp/credentials/HaystackEnterpriseOAuth2Api.credentials.ts.
// See HaystackEnterpriseApi.credentials.ts for why these can't be shared via a real npm
// dependency yet.
//
// Extends n8n's built-in `oAuth2Api` rather than implementing OAuth2/DCR ourselves. With
// `useDynamicClientRegistration` on (the default), n8n's own OAuth2 flow does everything on
// "Connect":
//   1. GET <serverUrl origin>/.well-known/oauth-protected-resource<serverUrl path> (RFC 9728)
//      → `authorization_servers[0]` (the Haystack Enterprise API origin, not the IdP) and the
//      `scopes_supported` to request.
//   2. GET <authorization server>/.well-known/oauth-authorization-server (RFC 8414)
//      → Authentik's authorize/token endpoints plus our own `registration_endpoint`.
//   3. POST <registration_endpoint> (RFC 7591, unauthenticated) with this n8n instance's own
//      callback URL → a client ID (and secret, for confidential clients) minted just for this
//      instance, stored on the credential by n8n.
//   4. The usual authorization-code (+ PKCE) browser login against Authentik.
// `authUrl`/`accessTokenUrl`/`grantType`/`clientId`/`clientSecret` and the other protocol settings
// are inherited from `oAuth2Api` and hidden while DCR is on. Switching DCR off reveals the full
// manual OAuth2 configuration for private deployments and for reusing an existing client.
//
// No `test` block on purpose: n8n ignores it for OAuth2-extending credentials and reports
// "connected"/"not connected" based on whether an access token is stored instead.
export class HaystackEnterpriseOAuth2Api implements ICredentialType {
	name = 'haystackEnterpriseOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Haystack Enterprise OAuth2 API';

	icon = 'file:../nodes/HaystackEnterprise/haystack-enterprise-electric-blue.svg' as const;

	documentationUrl =
		'https://github.com/deepset-ai/deepset-n8n-nodes/tree/main/packages/haystack-enterprise#credentials';

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
			// Overrides oAuth2Api's hidden, default-false field so DCR is the visible default here.
			displayName: 'Use Dynamic Client Registration',
			name: 'useDynamicClientRegistration',
			type: 'boolean',
			default: true,
			description:
				'Whether to let n8n register itself as an OAuth2 client automatically (RFC 7591); turn this off to configure or reuse an OAuth2 client manually.',
		},
		{
			// Same field as oAuth2Api's, re-declared to give it the Haystack Enterprise default and to
			// keep it visible: besides driving DCR discovery, the nodes derive the API base URL for
			// every request from it (like the API key credential's Server URL).
			displayName: 'Server URL',
			name: 'serverUrl',
			type: 'string',
			default: 'https://api.cloud.deepset.ai/api/v1',
			required: true,
			description:
				'The Haystack Enterprise API base URL, including /api/v1 (for example, https://api.cloud.deepset.ai/api/v1), used for API requests and OAuth2 authorization-server discovery and registration.',
		},
		{
			// Overrides oAuth2Api's required Client Secret: public PKCE clients intentionally have none.
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
