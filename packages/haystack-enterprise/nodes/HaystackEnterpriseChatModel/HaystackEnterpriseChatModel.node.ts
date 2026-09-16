import { supplyModel } from '@n8n/ai-node-sdk';
import type {
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { getApiBaseUrl, loadDeploymentOptions, loadWorkspaceOptions } from '../HaystackEnterprise/utils';

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
			},
		],
		properties: [
			{
				displayName:
					'Connect this node to an AI Agent Model input. The Agent builds the conversation; this node only supplies the Haystack Enterprise service.',
				name: 'connectionNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName:
					'Set up your Haystack Enterprise API credentials above first, then select your workspace below.',
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
				typeOptions: { loadOptionsMethod: 'getWorkspaces' },
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
					loadOptionsDependsOn: ['workspaceName'],
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
						displayName: 'Frequency Penalty',
						name: 'frequencyPenalty',
						type: 'number',
						typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 1 },
						default: 0,
						description:
							'Positive values penalize tokens based on how often they already appear, reducing repetition',
					},
					{
						displayName: 'Max Tokens',
						name: 'maxTokens',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 512,
						description: 'The maximum number of tokens to generate',
					},
					{
						displayName: 'Presence Penalty',
						name: 'presencePenalty',
						type: 'number',
						typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 1 },
						default: 0,
						description:
							'Positive values penalize tokens that have already appeared, increasing the chance of new topics',
					},
					{
						displayName: 'Sampling Temperature',
						name: 'temperature',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
						default: 0.7,
						description:
							'Controls randomness. Lower values make output more focused; higher values make it more random.',
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

		const credentials = await this.getCredentials('haystackEnterpriseApi');
		const apiKey = credentials.apiKey;
		if (typeof apiKey !== 'string' || apiKey === '') {
			throw new NodeOperationError(
				this.getNode(),
				'The Haystack Enterprise API credential is missing an API key.',
				{ itemIndex },
			);
		}

		const options = this.getNodeParameter('options', itemIndex, {}) as {
			frequencyPenalty?: number;
			maxTokens?: number;
			presencePenalty?: number;
			temperature?: number;
			timeout?: number;
			topP?: number;
		};

		// @n8n/ai-node-sdk types ISupplyDataFunctions from its nested n8n-workflow copy.
		return supplyModel(this as unknown as Parameters<typeof supplyModel>[0], {
			type: 'openai',
			baseUrl: `${getApiBaseUrl()}/workspaces/${workspaceName}/deployments/v1`,
			model: `${workspaceName}/${deploymentId}`,
			apiKey,
			useResponsesApi: false,
			supportsStrictToolCalling: false,
			temperature: options.temperature,
			maxTokens: options.maxTokens,
			topP: options.topP,
			frequencyPenalty: options.frequencyPenalty,
			presencePenalty: options.presencePenalty,
			timeout: options.timeout,
		});
	}
}
