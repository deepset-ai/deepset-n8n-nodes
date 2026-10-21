import { describe, expect, it } from 'vitest';

import { HaystackEnterpriseOAuth2Api } from '../credentials/HaystackEnterpriseOAuth2Api.credentials';

describe('HaystackEnterpriseOAuth2Api', () => {
	it('defaults to DCR while allowing users to switch to manual OAuth2', () => {
		const credential = new HaystackEnterpriseOAuth2Api();
		const properties = new Map(
			credential.properties.map((property) => [property.name, property] as const),
		);

		expect(properties.get('useDynamicClientRegistration')).toMatchObject({
			type: 'boolean',
			default: true,
		});
		expect(properties.get('serverUrl')).toMatchObject({
			type: 'string',
			default: 'https://api.cloud.deepset.ai',
		});
		expect(properties.get('scope')).toMatchObject({
			type: 'string',
			default: 'openid profile email offline_access',
			displayOptions: { show: { useDynamicClientRegistration: [false] } },
		});
		expect(properties.get('clientSecret')).toMatchObject({
			type: 'string',
			default: '',
			required: false,
			displayOptions: { show: { useDynamicClientRegistration: [false] } },
		});
		expect([...properties.keys()]).toEqual([
			'dynamicClientRegistrationNotice',
			'useDynamicClientRegistration',
			'serverUrl',
			'scope',
			'clientSecret',
			'organizationId',
		]);
	});
});
