import type { INodeProperties } from 'n8n-workflow';

export const serviceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['service'],
			},
		},
		options: [
			{
				name: 'Chat (Streaming)',
				value: 'chatStream',
				description:
					'Run a chat query against a deployed service and receive the answer incrementally, as it is generated',
				action: 'Chat with a service streaming',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a service by ID',
				action: 'Get a service',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List services in a workspace',
				action: 'Get many services',
			},
			{
				name: 'Search (Streaming)',
				value: 'searchStream',
				description:
					'Run a search query against a deployed service and receive the answer incrementally, as it is generated',
				action: 'Search a service streaming',
			},
		],
		default: 'getAll',
	},
];

const commonAdditionalFields: INodeProperties[] = [
	{
		displayName: 'File Names or IDs',
		name: 'files',
		type: 'string',
		default: '',
		placeholder: 'e.g. 3fa85f64-..., 3fa85f64-...',
		description: 'Comma-separated list of file IDs to restrict the search to',
	},
	{
		displayName: 'Filters (JSON)',
		name: 'filters',
		type: 'json',
		default: '',
		description: 'Haystack Enterprise filters to narrow down the search. See the Haystack Enterprise filtering logic docs.',
	},
	{
		displayName: 'Params (JSON)',
		name: 'params',
		type: 'json',
		default: '',
		description: 'Additional parameters passed to the underlying pipeline run',
	},
	{
		displayName: 'View Prompts',
		name: 'viewPrompts',
		type: 'boolean',
		default: false,
		description: 'Whether to add the runtime prompts of all nodes to the response (runs the pipeline in debug mode)',
	},
];

/**
 * Extra flags only the *-stream endpoints understand: they control which
 * additional event types Haystack Enterprise streams back (tool calls, tool call
 * results, reasoning), on top of the answer-text deltas that always stream.
 */
const streamingAdditionalFields: INodeProperties[] = [
	{
		displayName: 'Include Result',
		name: 'includeResult',
		type: 'boolean',
		default: true,
		description: 'Whether to stream a final event containing the complete pipeline result (answers/documents)',
	},
	{
		displayName: 'Include Tool Calls',
		name: 'includeToolCalls',
		type: 'boolean',
		default: false,
		description: 'Whether to stream events describing tool calls made by the pipeline',
	},
	{
		displayName: 'Include Tool Call Results',
		name: 'includeToolCallResults',
		type: 'boolean',
		default: false,
		description: 'Whether to stream events with the results returned by tool calls',
	},
	{
		displayName: 'Include Reasoning',
		name: 'includeReasoning',
		type: 'boolean',
		default: false,
		description: "Whether to stream the pipeline's intermediate reasoning output, if the underlying model supports it",
	},
];

export const serviceFields: INodeProperties[] = [
	// Get / Search (Streaming) / Chat (Streaming)
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
			'The service to use. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['get', 'searchStream', 'chatStream'],
			},
		},
	},
	{
		displayName: 'Wait for Service to Activate',
		name: 'waitForActivation',
		type: 'boolean',
		default: false,
		description:
			'Whether to automatically retry with backoff if the service is idle and being activated (API error 591), instead of failing immediately',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['searchStream', 'chatStream'],
			},
		},
	},
	{
		displayName: 'Max Wait Time (Minutes)',
		name: 'maxWaitMinutes',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 5,
		description:
			'Only used when "Wait for Service to Activate" is enabled. The maximum total time to keep retrying before giving up and returning the error.',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['searchStream', 'chatStream'],
				waitForActivation: [true],
			},
		},
	},
	// Get Many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: {
			show: {
				resource: ['service'],
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
				resource: ['service'],
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
				resource: ['service'],
				operation: ['getAll'],
			},
		},
		options: [
			{
				displayName: 'Group Label',
				name: 'groupLabel',
				type: 'string',
				default: '',
				description: 'Filter services by group label, e.g. PRODUCTION or DEVELOPMENT',
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
				resource: ['service'],
				operation: ['getAll'],
			},
		},
		options: [
			{
				displayName: 'Field',
				name: 'field',
				type: 'options',
				options: [
					{ name: 'Updated At', value: 'updated_at' },
					{ name: 'Created At', value: 'created_at' },
					{ name: 'Name', value: 'name' },
				],
				default: 'updated_at',
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
	// Search (Streaming)
	{
		displayName: 'Search',
		name: 'query',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 3 },
		placeholder: 'e.g. {{ $json.Subject }}',
		description: 'The search query to send to the service. Supports expressions.',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['searchStream'],
			},
		},
	},
	{
		displayName: 'Simplify Output',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to return one aggregated item with the concatenated answer text and final result, instead of one item per streamed event (deltas, tool calls, reasoning, the final result)',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['searchStream'],
			},
		},
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['searchStream'],
			},
		},
		options: [
			...commonAdditionalFields,
			{
				displayName: 'Search Session ID',
				name: 'searchSessionId',
				type: 'string',
				default: '',
				description: 'The ID of an existing search session to associate this query with',
			},
			...streamingAdditionalFields,
		],
	},
	// Chat (Streaming)
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		required: true,
		default: '',
		typeOptions: { rows: 3 },
		placeholder: 'e.g. {{ $json.Subject }}',
		description: 'The chat message to send to the service. Supports expressions.',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chatStream'],
			},
		},
	},
	{
		displayName: 'Search Session ID',
		name: 'searchSessionId',
		type: 'string',
		default: '',
		description:
			'The ID of an existing search session to continue, for chat history. Leave empty to chat without history. This node does not create search sessions automatically — creating a new one on every chat message would spam your workspace with sessions. Use the Search Session resource\'s Create operation to create one, and reuse its ID across calls in your workflow. See the package README for an example workflow.',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chatStream'],
			},
		},
	},
	{
		displayName: 'Simplify Output',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to return one aggregated item with the concatenated answer text and final result, instead of one item per streamed event (deltas, tool calls, reasoning, the final result)',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chatStream'],
			},
		},
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chatStream'],
			},
		},
		options: [
			...commonAdditionalFields,
			{
				displayName: 'Chat History Limit',
				name: 'chatHistoryLimit',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 3,
				description: 'The number of most recent chat history items (query and answer) to include in the chat',
			},
			...streamingAdditionalFields,
		],
	},
];
