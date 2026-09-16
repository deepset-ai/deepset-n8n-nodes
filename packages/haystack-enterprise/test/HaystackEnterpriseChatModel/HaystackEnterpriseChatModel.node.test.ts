import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ISupplyDataFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { HaystackEnterpriseChatModel } from '../../nodes/HaystackEnterpriseChatModel/HaystackEnterpriseChatModel.node';
import { setApiBaseUrlOverrideForTests } from '../../nodes/HaystackEnterprise/utils';

const supplyModel = vi.fn((_ctx: unknown, model: unknown) => ({ response: model }));

vi.mock('@n8n/ai-node-sdk', () => ({
	supplyModel: (...args: unknown[]) => supplyModel(...args),
}));

function createSupplyDataContext(
	params: Record<string, unknown>,
	credentials: Record<string, unknown> = { apiKey: 'secret-key' },
) {
	return {
		getNode: () => ({ name: 'Haystack Enterprise Chat Model' }),
		getCredentials: async () => credentials,
		getNodeParameter: (name: string, _itemIndex: number, fallback?: unknown) =>
			Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback,
	} as unknown as ISupplyDataFunctions;
}

describe('HaystackEnterpriseChatModel', () => {
	const node = new HaystackEnterpriseChatModel();

	beforeEach(() => {
		supplyModel.mockClear();
		setApiBaseUrlOverrideForTests(undefined);
	});

	it('supplies an OpenAI-compatible model pointed at the deployment chat completions URL', async () => {
		const context = createSupplyDataContext({
			workspaceName: 'acme',
			deploymentId: 'support-chat',
			options: { temperature: 0.2, maxTokens: 256 },
		});

		const result = await node.supplyData.call(context, 0);

		expect(supplyModel).toHaveBeenCalledWith(context, {
			type: 'openai',
			baseUrl: 'https://api.cloud.deepset.ai/api/v1/workspaces/acme/deployments/v1',
			model: 'acme/support-chat',
			apiKey: 'secret-key',
			useResponsesApi: false,
			supportsStrictToolCalling: false,
			temperature: 0.2,
			maxTokens: 256,
			topP: undefined,
			frequencyPenalty: undefined,
			presencePenalty: undefined,
			timeout: undefined,
		});
		expect(result.response).toMatchObject({ type: 'openai', model: 'acme/support-chat' });
	});

	it('throws when workspace or service is missing', async () => {
		const context = createSupplyDataContext({ workspaceName: '', deploymentId: 'support-chat' });

		await expect(node.supplyData.call(context, 0)).rejects.toBeInstanceOf(NodeOperationError);
		expect(supplyModel).not.toHaveBeenCalled();
	});

	it('throws when the credential has no API key', async () => {
		const context = createSupplyDataContext(
			{ workspaceName: 'acme', deploymentId: 'support-chat' },
			{ apiKey: '' },
		);

		await expect(node.supplyData.call(context, 0)).rejects.toBeInstanceOf(NodeOperationError);
		expect(supplyModel).not.toHaveBeenCalled();
	});
});
