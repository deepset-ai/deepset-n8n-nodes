import type {
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { supplyModel } from '@n8n/ai-node-sdk';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	getApiBaseUrlForContext,
	loadDeploymentOptions,
	loadWorkspaceOptions,
	resolveBearerToken,
} from '../HaystackEnterprise/utils';

export class HaystackEnterpriseChatModel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Haystack Enterprise Chat Model',
		name: 'haystackEnterpriseChatModel',
		icon: 'file:../HaystackEnterprise/haystack-enterprise-electric-blue.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["deploymentId"]}}',
		description:
			'Language model for n8n AI Agent. Runs Chat Completions on a Haystack Enterprise service.',
		defaults: {
			name: 'Haystack Enterprise Chat Model',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models'],
				'Language Models': ['Chat Models (Recommended)'],
			},
			resources: {
				primaryDocumentation: [
					{
						url: 'https://docs.cloud.deepset.ai/docs/api',
					},
				],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		credentials: [
			{
				name: 'haystackEnterpriseApi',
				required: true,
				displayOptions: { show: { authentication: ['apiKey'] } },
			},
			{
				name: 'haystackEnterpriseOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'API Key',
						value: 'apiKey',
						description: 'Authenticate with a Haystack Enterprise API key',
					},
					{
						name: 'OAuth2',
						value: 'oAuth2',
						description: 'Sign in with your Haystack Enterprise user account',
					},
				],
				default: 'apiKey',
			},
			{
				displayName:
					'Connect this node to an AI Agent Model input. The Agent builds the conversation; this node only supplies the Haystack Enterprise service.',
				name: 'connectionNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName:
					'Set up your Haystack Enterprise credential above first, then select your workspace below.',
				name: 'workspaceNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						workspaceName: [''],
					},
				},
			},
			{
				displayName: 'Workspace Name or ID',
				name: 'workspaceName',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getWorkspaces',
					loadOptionsDependsOn: ['authentication'],
				},
				default: '',
				required: true,
				description:
					'Select your <a href="https://docs.cloud.deepset.ai/docs/basic-concepts#workspace" target="_blank" rel="noopener noreferrer">workspace</a>, populated from your Haystack Enterprise Platform account. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Service Name or ID',
				name: 'deploymentId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDeployments',
					loadOptionsDependsOn: ['authentication', 'workspaceName'],
				},
				default: '',
				required: true,
				description:
					'The deployed service to use as the language model. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Options',
				name: 'options',
				placeholder: 'Add Option',
				type: 'collection',
				default: {},
				options: [
					{
						displayName: 'Extra Parameters (JSON)',
						name: 'extraParameters',
						type: 'json',
						default: '{}',
						description:
							'Other OpenAI fields forwarded as-is (for example temperature, frequency_penalty, presence_penalty, response_format). Merged over the named fields below.',
					},
					{
						displayName: 'Max Completion Tokens',
						name: 'maxCompletionTokens',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 512,
						description: 'The maximum number of tokens to generate',
					},
					{
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 60000,
						description: 'Maximum time in ms to wait for a response',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 1 },
						default: 1,
						description: 'Nucleus sampling probability mass',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getWorkspaces(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadWorkspaceOptions(this);
			},
			async getDeployments(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadDeploymentOptions(this);
			},
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
		const deploymentId = this.getNodeParameter('deploymentId', itemIndex) as string;
		if (!workspaceName || !deploymentId) {
			throw new NodeOperationError(
				this.getNode(),
				'A workspace and a service are required. Select both above.',
				{ itemIndex },
			);
		}

		// The SDK accepts a static token, so OAuth2 credentials are validated before use.
		const apiKey = await resolveBearerToken(this);

		const options = this.getNodeParameter('options', itemIndex, {}) as {
			extraParameters?: unknown;
			maxCompletionTokens?: number;
			timeout?: number;
			topP?: number;
		};

		const additionalParams: Record<string, unknown> = {};
		if (options.maxCompletionTokens !== undefined) {
			additionalParams.max_completion_tokens = options.maxCompletionTokens;
		}
		if (options.topP !== undefined) additionalParams.top_p = options.topP;
		Object.assign(
			additionalParams,
			parseExtraParameters.call(this, itemIndex, options.extraParameters),
		);

		const temperature = additionalParams.temperature;
		delete additionalParams.temperature;

		const apiBaseUrl = await getApiBaseUrlForContext(this);

		// @n8n/ai-node-sdk types ISupplyDataFunctions from its nested n8n-workflow copy.
		return supplyModel(this as unknown as Parameters<typeof supplyModel>[0], {
			type: 'openai',
			baseUrl: `${apiBaseUrl}/workspaces/${workspaceName}/deployments/v1`,
			model: `${workspaceName}/${deploymentId}`,
			apiKey,
			useResponsesApi: false,
			supportsStrictToolCalling: false,
			timeout: options.timeout,
			// Default temperature is 1 (not ChatOpenAI's 0.7); Extra Parameters can override it.
			temperature: typeof temperature === 'number' ? temperature : 1,
			additionalParams: Object.keys(additionalParams).length > 0 ? additionalParams : undefined,
		});
	}
}

function parseExtraParameters(
	this: ISupplyDataFunctions,
	itemIndex: number,
	value: unknown,
): Record<string, unknown> {
	if (value === undefined || value === null || value === '') {
		return {};
	}
	let parsed: unknown = value;
	if (typeof value === 'string') {
		if (value.trim() === '') return {};
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new NodeOperationError(this.getNode(), '"Extra Parameters (JSON)" is not valid JSON', {
				itemIndex,
			});
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new NodeOperationError(
			this.getNode(),
			'"Extra Parameters (JSON)" must be a JSON object',
			{
				itemIndex,
			},
		);
	}
	const extras = { ...(parsed as Record<string, unknown>) };
	delete extras.messages;
	delete extras.model;
	delete extras.stream;
	return extras;
}
