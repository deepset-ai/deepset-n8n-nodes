import { describe, expect, it } from 'vitest';

import { HaystackEnterpriseOAuth2Api } from '../credentials/HaystackEnterpriseOAuth2Api.credentials';

describe('HaystackEnterpriseOAuth2Api', () => {
	it('uses the standard manual OAuth2 flow without DCR', () => {
		const credential = new HaystackEnterpriseOAuth2Api();
		const properties = new Map(
			credential.properties.map((property) => [property.name, property] as const),
		);

		expect(properties.get('serverUrl')).toMatchObject({
			type: 'string',
			default: 'https://api.cloud.deepset.ai',
		});
		expect(properties.get('scope')).toMatchObject({
			type: 'string',
			default: 'openid profile email offline_access',
		});
		expect(properties.get('clientSecret')).toMatchObject({
			type: 'string',
			default: '',
			required: false,
		});
		expect([...properties.keys()]).toEqual([
			'serverUrl',
			'scope',
			'clientSecret',
			'organizationId',
		]);
	});
});
