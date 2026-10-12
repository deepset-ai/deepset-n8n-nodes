import type { ISupplyDataFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setApiBaseUrlOverrideForTests } from '../../nodes/HaystackEnterprise/utils';
import { HaystackEnterpriseChatModel } from '../../nodes/HaystackEnterpriseChatModel/HaystackEnterpriseChatModel.node';

const supplyModel = vi.fn((_ctx: unknown, model: unknown) => ({ response: model }));

vi.mock('@n8n/ai-node-sdk', () => ({
	supplyModel: (...args: unknown[]) => supplyModel(...args),
}));

function createSupplyDataContext(
	params: Record<string, unknown>,
	credentials: Record<string, unknown> = { apiKey: 'secret-key' },
	httpRequestWithAuthentication: (...args: unknown[]) => unknown = vi.fn(async () => []),
) {
	return {
		getNode: () => ({ name: 'Haystack Enterprise Chat Model' }),
		getCredentials: vi.fn(async () => credentials),
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback,
		helpers: { httpRequestWithAuthentication },
	} as unknown as ISupplyDataFunctions;
}

const OAUTH2_PARAMS = {
	authentication: 'oAuth2',
	workspaceName: 'acme',
	deploymentId: 'support-chat',
	options: {},
};

describe('HaystackEnterpriseChatModel', () => {
	const node = new HaystackEnterpriseChatModel();

	beforeEach(() => {
		supplyModel.mockClear();
		setApiBaseUrlOverrideForTests(undefined);
	});

	it('supplies an OpenAI-compatible model pointed at the service chat completions URL', async () => {
		const context = createSupplyDataContext({
			workspaceName: 'acme',
			deploymentId: 'support-chat',
			options: { maxCompletionTokens: 256 },
		});

		const result = await node.supplyData.call(context, 0);

		expect(supplyModel).toHaveBeenCalledWith(context, {
			type: 'openai',
			baseUrl: 'https://api.cloud.deepset.ai/api/v1/workspaces/acme/deployments/v1',
			model: 'acme/support-chat',
			apiKey: 'secret-key',
			useResponsesApi: false,
			supportsStrictToolCalling: false,
			timeout: undefined,
			temperature: 1,
			additionalParams: { max_completion_tokens: 256 },
		});
		expect(result.response).toMatchObject({ type: 'openai', model: 'acme/support-chat' });
	});

	it('lets extra parameters override named generation fields and the default temperature', async () => {
		const context = createSupplyDataContext({
			workspaceName: 'acme',
			deploymentId: 'support-chat',
			options: {
				maxCompletionTokens: 256,
				extraParameters: '{"temperature": 0.9, "presence_penalty": 0.1}',
			},
		});

		await node.supplyData.call(context, 0);

		expect(supplyModel).toHaveBeenCalledWith(
			context,
			expect.objectContaining({
				temperature: 0.9,
				additionalParams: {
					max_completion_tokens: 256,
					presence_penalty: 0.1,
				},
			}),
		);
	});

	it('throws when workspace or service is missing', async () => {
		const context = createSupplyDataContext({ workspaceName: '', deploymentId: 'support-chat' });

		await expect(node.supplyData.call(context, 0)).rejects.toBeInstanceOf(NodeOperationError);
		expect(supplyModel).not.toHaveBeenCalled();
	});

	it('uses the Server URL from credentials for the chat completions base URL', async () => {
		const context = createSupplyDataContext(
			{
				workspaceName: 'acme',
				deploymentId: 'support-chat',
				options: {},
			},
			{ apiKey: 'secret-key', serverUrl: 'https://self-hosted.example.com/' },
		);

		await node.supplyData.call(context, 0);

		expect(supplyModel).toHaveBeenCalledWith(
			context,
			expect.objectContaining({
				baseUrl: 'https://self-hosted.example.com/api/v1/workspaces/acme/deployments/v1',
			}),
		);
	});

	it('throws when the credential has no API key', async () => {
		const context = createSupplyDataContext(
			{ workspaceName: 'acme', deploymentId: 'support-chat' },
			{ apiKey: '' },
		);

		await expect(node.supplyData.call(context, 0)).rejects.toBeInstanceOf(NodeOperationError);
		expect(supplyModel).not.toHaveBeenCalled();
	});

	it('does not make a validation request when authenticating with an API key', async () => {
		const httpRequestWithAuthentication = vi.fn();
		const context = createSupplyDataContext(
			{ workspaceName: 'acme', deploymentId: 'support-chat', options: {} },
			{ apiKey: 'secret-key' },
			httpRequestWithAuthentication,
		);

		await node.supplyData.call(context, 0);

		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
		expect(context.getCredentials).toHaveBeenCalledWith('haystackEnterpriseApi');
	});

	describe('OAuth2', () => {
		it('validates the token through n8n (so an expired one gets refreshed) and supplies the stored access token', async () => {
			const httpRequestWithAuthentication = vi.fn(async () => []);
			const context = createSupplyDataContext(
				OAUTH2_PARAMS,
				{ oauthTokenData: { access_token: 'oauth-token' } },
				httpRequestWithAuthentication,
			);

			await node.supplyData.call(context, 0);

			expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
				'haystackEnterpriseOAuth2Api',
				expect.objectContaining({
					method: 'GET',
					url: 'https://api.cloud.deepset.ai/api/v1/workspaces',
				}),
			);
			expect(context.getCredentials).not.toHaveBeenCalledWith('haystackEnterpriseApi');
			expect(supplyModel).toHaveBeenCalledWith(
				context,
				expect.objectContaining({ apiKey: 'oauth-token' }),
			);
		});

		it('supplies the refreshed access token when the validation request triggered a refresh', async () => {
			let tokenData = { access_token: 'stale-token' };
			const httpRequestWithAuthentication = vi.fn(async () => {
				tokenData = { access_token: 'fresh-token' };
				return [];
			});
			const context = createSupplyDataContext(OAUTH2_PARAMS, {}, httpRequestWithAuthentication);
			(context.getCredentials as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
				oauthTokenData: tokenData,
			}));

			await node.supplyData.call(context, 0);

			expect(supplyModel).toHaveBeenCalledWith(
				context,
				expect.objectContaining({ apiKey: 'fresh-token' }),
			);
		});

		it("derives the chat completions base URL from the OAuth2 credential's Server URL (which includes /api/v1)", async () => {
			const context = createSupplyDataContext(OAUTH2_PARAMS, {
				serverUrl: 'https://self-hosted.example.com/api/v1',
				oauthTokenData: { access_token: 'oauth-token' },
			});

			await node.supplyData.call(context, 0);

			expect(supplyModel).toHaveBeenCalledWith(
				context,
				expect.objectContaining({
					baseUrl: 'https://self-hosted.example.com/api/v1/workspaces/acme/deployments/v1',
				}),
			);
		});

		it('tells the user to Connect when the OAuth2 credential has no access token yet', async () => {
			const httpRequestWithAuthentication = vi.fn();
			const context = createSupplyDataContext(OAUTH2_PARAMS, {}, httpRequestWithAuthentication);

			await expect(node.supplyData.call(context, 0)).rejects.toThrow(/not connected yet.*Connect/);
			expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
			expect(supplyModel).not.toHaveBeenCalled();
		});

		it('surfaces the API error when the validation request fails (e.g. refresh token revoked)', async () => {
			const httpRequestWithAuthentication = vi.fn(async () => {
				throw Object.assign(new Error('Request failed with status code 401'), {
					response: { status: 401, data: { errors: ['Unauthorized'] } },
				});
			});
			const context = createSupplyDataContext(
				OAUTH2_PARAMS,
				{ oauthTokenData: { access_token: 'stale-token' } },
				httpRequestWithAuthentication,
			);

			await expect(node.supplyData.call(context, 0)).rejects.toThrow(
				/reconnect the OAuth2 credential/,
			);
			expect(supplyModel).not.toHaveBeenCalled();
		});
	});
});
