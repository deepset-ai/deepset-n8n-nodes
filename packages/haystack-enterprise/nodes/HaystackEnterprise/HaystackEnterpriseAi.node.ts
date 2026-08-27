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
import {
	loadDeploymentOptions,
	loadDeploymentOptionsWithAllOption,
	loadFileOptions,
	loadIndexOptions,
	loadSearchSessionOptions,
	loadWorkspaceOptions,
} from './utils';
import { fileFields, fileOperations } from './resources/file/File.description';
import { executeFile } from './resources/file/File.execute';
import { indexFields, indexOperations } from './resources/index/Index.description';
import { executeIndex } from './resources/index/Index.execute';
import { searchSessionFields, searchSessionOperations } from './resources/searchSession/SearchSession.description';
import { executeSearchSession } from './resources/searchSession/SearchSession.execute';
import { serviceFields, serviceOperations } from './resources/service/Service.description';
import { executeService } from './resources/service/Service.execute';

export class HaystackEnterpriseAi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Haystack Enterprise AI',
		name: 'haystackEnterpriseAi',
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
			},
		],
		properties: [
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
			async getDeploymentsWithAllOption(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
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
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, { itemIndex: i });
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
				// NodeApiError's constructor is a no-op passthrough when given an existing
				// NodeApiError (see utils.ts's withApiErrorWrapping for the same gotcha), so
				// mutating .context.itemIndex directly is the only way to attach it here.
				if (caught instanceof NodeApiError) {
					const error = caught;
					error.context.itemIndex = i;
					throw error;
				}
				throw new NodeApiError(this.getNode(), caught as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
