import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { fileFields, fileOperations } from './resources/file/File.description';
import { executeFile } from './resources/file/File.execute';
import { indexFields, indexOperations } from './resources/index/Index.description';
import { executeIndex } from './resources/index/Index.execute';
import {
	searchSessionFields,
	searchSessionOperations,
} from './resources/searchSession/SearchSession.description';
import { executeSearchSession } from './resources/searchSession/SearchSession.execute';
import { serviceFields, serviceOperations } from './resources/service/Service.description';
import { executeService } from './resources/service/Service.execute';
import {
	isNodeApiError,
	loadDeploymentOptions,
	loadDeploymentOptionsWithAllOption,
	loadFileOptions,
	loadIndexOptions,
	loadSearchSessionOptions,
	loadWorkspaceOptions,
} from './utils';

export class HaystackEnterpriseAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Haystack Enterprise AI',
		name: 'haystackEnterpriseAi',
		// The icon is designed to work on both light and dark themes, so a single file is enough.
		// eslint-disable-next-line @n8n/community-nodes/icon-prefer-themed-variants
		icon: 'file:haystack-enterprise-electric-blue.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Manage files and query deployed services on the Haystack Enterprise Platform.',
		defaults: {
			name: 'Haystack Enterprise AI',
		},
		usableAsTool: true,
		codex: {
			categories: ['Development', 'Data & Storage'],
			resources: {
				primaryDocumentation: [
					{
						url: 'https://docs.cloud.deepset.ai/docs/api',
					},
				],
			},
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
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
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'File', value: 'file' },
					{ name: 'Index', value: 'index' },
					{ name: 'Search Session', value: 'searchSession' },
					{ name: 'Service', value: 'service' },
				],
				default: 'service',
			},
			...fileOperations,
			...fileFields,
			...indexOperations,
			...indexFields,
			...searchSessionOperations,
			...searchSessionFields,
			...serviceOperations,
			...serviceFields,
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
			async getDeploymentsWithAllOption(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				return loadDeploymentOptionsWithAllOption(this);
			},
			async getFiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadFileOptions(this);
			},
			async getIndexes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadIndexOptions(this);
			},
			async getSearchSessions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadSearchSessionOptions(this);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				let resultItems: INodeExecutionData[];
				if (resource === 'file') {
					resultItems = await executeFile.call(this, operation, i);
				} else if (resource === 'index') {
					resultItems = await executeIndex.call(this, operation, i);
				} else if (resource === 'service') {
					resultItems = await executeService.call(this, operation, i);
				} else if (resource === 'searchSession') {
					resultItems = await executeSearchSession.call(this, operation, i);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, {
						itemIndex: i,
					});
				}

				for (const item of resultItems) {
					returnData.push({ ...item, pairedItem: item.pairedItem ?? { item: i } });
				}
			} catch (caught) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (caught as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}

				if (caught instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), caught.message, { itemIndex: i });
				}
				// Preserve errors created by n8n's separate n8n-workflow module copy.
				if (isNodeApiError(caught)) {
					if (caught.context) caught.context.itemIndex = i;
					// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- already a NodeApiError; constructing a new one replaces .message with the generic status text
					throw caught;
				}
				throw new NodeApiError(this.getNode(), caught as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
