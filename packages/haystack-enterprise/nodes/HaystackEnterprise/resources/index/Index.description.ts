import type { INodeProperties } from 'n8n-workflow';

const DOCS_BASE_URL = 'https://docs.cloud.deepset.ai/docs/api/main';

const apiDocsNotice = (operation: string, urlSlug: string): INodeProperties => ({
	displayName: `See the <a href="${DOCS_BASE_URL}/${urlSlug}" target="_blank">Haystack Enterprise API docs</a> for this endpoint`,
	name: `apiDocsNotice_${operation}`,
	type: 'notice',
	default: '',
	displayOptions: {
		show: {
			resource: ['index'],
			operation: [operation],
		},
	},
});

export const indexOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['index'],
			},
		},
		options: [
			{ name: 'Get', value: 'get', description: 'Get an index by name', action: 'Get an index' },
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List indexes in a workspace',
				action: 'Get many indexes',
			},
		],
		default: 'getAll',
	},
];

export const indexFields: INodeProperties[] = [
	// Get
	apiDocsNotice('get', 'get-index-by-name-api-v-1-workspaces-workspace-name-indexes-index-name-get'),
	{
		displayName: 'Index Name or ID',
		name: 'indexName',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getIndexes',
			loadOptionsDependsOn: ['workspaceName'],
		},
		default: '',
		required: true,
		description:
			'The index to use. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				resource: ['index'],
				operation: ['get'],
			},
		},
	},
	// Get Many
	apiDocsNotice('getAll', 'get-indexes-api-v-1-workspaces-workspace-name-indexes-get'),
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: {
			show: {
				resource: ['index'],
				operation: ['getAll'],
			},
		},
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: {
				resource: ['index'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: {
				resource: ['index'],
				operation: ['getAll'],
			},
		},
		options: [
			{
				displayName: 'OData Filter',
				name: 'odataFilter',
				type: 'string',
				default: '',
				placeholder: "e.g. desired_status eq 'DEPLOYED'",
				description:
					'An OData filter expression, supporting exact match and AND. See the <a href="https://www.odata.org/getting-started/basic-tutorial/#queryData">OData filter syntax</a>.',
			},
		],
	},
	{
		displayName: 'Sort',
		name: 'sort',
		type: 'collection',
		placeholder: 'Add Sort Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['index'],
				operation: ['getAll'],
			},
		},
		options: [
			{
				displayName: 'Field',
				name: 'field',
				type: 'options',
				options: [
					{ name: 'Created At', value: 'created_at' },
					{ name: 'Created By Family Name', value: 'created_by/family_name' },
					{ name: 'Created By Given Name', value: 'created_by/given_name' },
					{ name: 'Created By User ID', value: 'created_by/user_id' },
					{ name: 'Name', value: 'name' },
				],
				default: 'created_at',
			},
			{
				displayName: 'Order',
				name: 'order',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'ASC' },
					{ name: 'Descending', value: 'DESC' },
				],
				default: 'DESC',
			},
		],
	},
];
