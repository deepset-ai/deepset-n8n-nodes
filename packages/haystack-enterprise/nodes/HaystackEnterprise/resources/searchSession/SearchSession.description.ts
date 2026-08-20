import type { INodeProperties } from 'n8n-workflow';
import { createApiDocsNotice } from '../shared';

const apiDocsNotice = createApiDocsNotice('searchSession');

export const searchSessionOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['searchSession'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a search session for a service, to use as chat history',
				action: 'Create a search session',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a search session and its search history',
				action: 'Delete a search session',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List search sessions in a workspace',
				action: 'Get many search sessions',
			},
		],
		default: 'getAll',
	},
];

export const searchSessionFields: INodeProperties[] = [
	// TODO: unlike Delete/Get Many, Create has no apiDocsNotice() (see
	// resources/shared.ts) linking the Haystack Enterprise API docs. The
	// deployment path is currently excluded from the OpenAPI schema
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
			'The service to create a search session for. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				resource: ['searchSession'],
				operation: ['create'],
			},
		},
	},
	// Delete
	apiDocsNotice(
		'delete',
		'delete-search-session-api-v-1-workspaces-workspace-name-search-sessions-search-session-id-delete',
	),
	{
		displayName: 'Search Session Name or ID',
		name: 'searchSessionId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getSearchSessions',
			loadOptionsDependsOn: ['workspaceName'],
		},
		default: '',
		required: true,
		description:
			'The search session to delete. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				resource: ['searchSession'],
				operation: ['delete'],
			},
		},
	},
	// Get Many
	apiDocsNotice('getAll', 'get-search-sessions-api-v-1-workspaces-workspace-name-search-sessions-get'),
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: {
			show: {
				resource: ['searchSession'],
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
				resource: ['searchSession'],
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
				resource: ['searchSession'],
				operation: ['getAll'],
			},
		},
		options: [
			{
				displayName: 'OData Filter',
				name: 'odataFilter',
				type: 'string',
				default: '',
				placeholder: "e.g. title eq 'Support chat'",
				description:
					'An OData filter expression, supporting exact match and AND. See the <a href="https://www.odata.org/getting-started/basic-tutorial/#queryData">OData filter syntax</a>.',
			},
			{
				displayName: 'Before (Search Session ID)',
				name: 'before',
				type: 'string',
				default: '',
				placeholder: 'e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6',
				description:
					"Only applies when Return All is off. Returns entries before this search session ID (cursor-based pagination) instead of using Limit's page-number pagination.",
			},
			{
				displayName: 'After (Search Session ID)',
				name: 'after',
				type: 'string',
				default: '',
				placeholder: 'e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6',
				description:
					"Only applies when Return All is off. Returns entries after this search session ID (cursor-based pagination) instead of using Limit's page-number pagination.",
			},
		],
	},
];
