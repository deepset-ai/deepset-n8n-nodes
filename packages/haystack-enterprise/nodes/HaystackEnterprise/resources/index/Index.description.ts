import type { INodeProperties } from 'n8n-workflow';
import { createApiDocsNotice } from '../shared';

const apiDocsNotice = createApiDocsNotice('index');

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
	apiDocsNotice(
		'get',
		'get-index-by-name-api-v-1-workspaces-workspace-name-indexes-index-name-get',
	),
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
			{
				displayName: 'Select',
				name: 'select',
				type: 'string',
				default: '',
				placeholder: 'e.g. name, created_by/user_id',
				description:
					"Partial implementation of the OData $select operator — comma-separated fields to return instead of the full object. Only supports selecting fields from the root entity or one level of child entity (e.g. created_by/user_id), not children's children.",
			},
			{
				displayName: 'Before (Index ID)',
				name: 'before',
				type: 'string',
				default: '',
				placeholder: 'e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6',
				description:
					"Only applies when Return All is off. Returns entries before this index ID (cursor-based pagination) instead of using Limit's page-number pagination.",
			},
			{
				displayName: 'After (Index ID)',
				name: 'after',
				type: 'string',
				default: '',
				placeholder: 'e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6',
				description:
					"Only applies when Return All is off. Returns entries after this index ID (cursor-based pagination) instead of using Limit's page-number pagination.",
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
