import type { INodeProperties } from 'n8n-workflow';

import { createApiDocsNotice } from '../shared';

const apiDocsNotice = createApiDocsNotice('service');

// TODO: Get, Get Many and List Models have no apiDocsNotice() yet (see
// resources/shared.ts). Add them once their pages are published in the
// Haystack Enterprise API docs.
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
				name: 'Chat',
				value: 'chat',
				description:
					'Run a chat query against a service and receive the full answer once generation finishes',
				action: 'Chat with a service',
			},
			{
				name: 'Chat (Streaming)',
				value: 'chatStream',
				description:
					'Run a chat query against a service and receive the answer incrementally, as it is generated',
				action: 'Chat with a service streaming',
			},
			{
				name: 'Chat Completions',
				value: 'chatCompletions',
				description:
					'Run an OpenAI-style chat completion against a service. Clients send the full conversation in messages.',
				action: 'Create a chat completion',
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
				name: 'List Models (Chat Completions)',
				value: 'listModels',
				description:
					'List workspace services as OpenAI-compatible models to use it with Chat Completions (`model` parameter)',
				action: 'List models for chat completions',
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
		description: 'Comma-separated temporary file IDs to pass as pipeline input',
	},
	{
		displayName: 'Filters (JSON)',
		name: 'filters',
		type: 'json',
		default: '',
		description:
			'Haystack Enterprise filters to narrow down the search. See the Haystack Enterprise filtering logic docs.',
	},
	{
		displayName: 'Params (JSON)',
		name: 'params',
		type: 'json',
		default: '',
		description: 'Additional parameters passed to the underlying pipeline run',
	},
];

const chatHistoryLimitField: INodeProperties = {
	displayName: 'Chat History Limit',
	name: 'chatHistoryLimit',
	type: 'number',
	typeOptions: { minValue: 0 },
	default: 3,
	description:
		'The number of most recent chat history items (query and answer) to include in the chat',
};

const storeSearchHistoryField: INodeProperties = {
	displayName: 'Store Search History',
	name: 'storeSearchHistory',
	type: 'boolean',
	default: true,
	description:
		'Whether to persist the query and response in the chat history for this search session. Opting out is only supported by deployed services with a serverless execution mode.',
};

const chatHistoryGranularityField: INodeProperties = {
	displayName: 'Chat History Granularity',
	name: 'chatHistoryGranularity',
	type: 'options',
	default: 'QUERY_ANSWER',
	description: 'Which messages from each previous turn to include in the chat history',
	options: [
		{
			name: 'All Messages',
			value: 'ALL_MESSAGES',
			description: 'Replay every message from the chat history to the pipeline',
		},
		{
			name: 'Query and Answer',
			value: 'QUERY_ANSWER',
			description: 'Include only the user query and the final answer from each turn',
		},
	],
};

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
		description:
			'Whether to stream a final event containing the complete pipeline result (answers/documents)',
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
		description:
			"Whether to stream the pipeline's intermediate reasoning output, if the underlying model supports it",
	},
];

export const serviceFields: INodeProperties[] = [
	apiDocsNotice(
		'chat',
		'chat-api-v-1-workspaces-workspace-name-deployments-deployment-id-chat-post',
	),
	apiDocsNotice(
		'chatStream',
		'chat-stream-api-v-1-workspaces-workspace-name-deployments-deployment-id-chat-stream-post',
	),
	apiDocsNotice(
		'chatCompletions',
		'chat-completions-api-v-1-workspaces-workspace-name-deployments-v-1-chat-completions-post',
	),
	// Get / Chat / Chat (Streaming) / Chat Completions
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
				operation: ['get', 'chat', 'chatStream', 'chatCompletions'],
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
				operation: ['chat', 'chatStream', 'chatCompletions'],
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
				operation: ['chat', 'chatStream', 'chatCompletions'],
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
			{
				displayName: 'OData Filter',
				name: 'odataFilter',
				type: 'string',
				default: '',
				placeholder: "e.g. status eq 'DEPLOYED' and pipeline_name eq 'my-pipeline'",
				description:
					'An OData filter expression, supporting exact match and AND. Supported fields: status (one of DEPLOYED, UNDEPLOYED, DEPLOYMENT_IN_PROGRESS, DEPLOYMENT_FAILED, or IDLE — IDLE is accepted but always returns 0 rows since it\'s derived at read time rather than persisted; any other value returns a 422 error) and pipeline_name. See the <a href="https://www.odata.org/getting-started/basic-tutorial/#queryData">OData filter syntax</a>.',
			},
			{
				displayName: 'Before (Service ID)',
				name: 'before',
				type: 'string',
				default: '',
				placeholder: 'e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6',
				description:
					'Only applies when Return All is off. Returns entries before this service ID (cursor-based pagination) instead of using Limit\'s page-number pagination. Not supported together with Sort Field "Pipeline Name" (returns a 422 error).',
			},
			{
				displayName: 'After (Service ID)',
				name: 'after',
				type: 'string',
				default: '',
				placeholder: 'e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6',
				description:
					'Only applies when Return All is off. Returns entries after this service ID (cursor-based pagination) instead of using Limit\'s page-number pagination. Not supported together with Sort Field "Pipeline Name" (returns a 422 error).',
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
					{ name: 'Pipeline Name', value: 'pipeline_name' },
				],
				default: 'updated_at',
				description:
					'Not supported together with a Before/After cursor (returns a 422 error) when set to Pipeline Name',
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
	// Chat / Chat (Streaming)
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
				operation: ['chat', 'chatStream'],
			},
		},
	},
	{
		displayName: 'Search Session ID',
		name: 'searchSessionId',
		type: 'string',
		default: '',
		description:
			"The ID of an existing search session to continue, for chat history. Leave empty to start a new session automatically — its ID is returned in the output's search_session_id field, ready to reuse on the next call to continue the conversation.",
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chat', 'chatStream'],
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
				operation: ['chat'],
			},
		},
		options: [...commonAdditionalFields, chatHistoryLimitField, chatHistoryGranularityField],
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
			chatHistoryLimitField,
			chatHistoryGranularityField,
			storeSearchHistoryField,
			...streamingAdditionalFields,
		],
	},
	// Chat Completions
	{
		displayName: 'Messages Input',
		name: 'messagesInput',
		type: 'options',
		options: [
			{ name: 'Define Below', value: 'fields' },
			{ name: 'JSON', value: 'json' },
		],
		default: 'fields',
		description:
			'How to provide the conversation. Use JSON for multimodal content parts, tool-call-only assistant messages, or a messages array from a previous node.',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chatCompletions'],
			},
		},
	},
	{
		displayName: 'Messages',
		name: 'messages',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Message',
		default: { message: [{ role: 'user', content: '' }] },
		required: true,
		description:
			'Conversation history sent to the service. Include prior turns for multi-turn chat.',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chatCompletions'],
				messagesInput: ['fields'],
			},
		},
		options: [
			{
				displayName: 'Message',
				name: 'message',
				values: [
					{
						displayName: 'Role',
						name: 'role',
						type: 'options',
						options: [
							{ name: 'Assistant', value: 'assistant' },
							{ name: 'System', value: 'system' },
							{ name: 'Tool', value: 'tool' },
							{ name: 'User', value: 'user' },
						],
						default: 'user',
						description: 'The role of the message sender',
					},
					{
						displayName: 'Content',
						name: 'content',
						type: 'string',
						default: '',
						typeOptions: { rows: 3 },
						description:
							'The message text. For tool-call-only assistant messages or multimodal content parts, use JSON input instead.',
					},
					{
						displayName: 'Tool Call ID',
						name: 'toolCallId',
						type: 'string',
						default: '',
						description:
							'The ID of the tool call this message is the result of. Required on tool messages.',
						displayOptions: {
							show: {
								role: ['tool'],
							},
						},
					},
				],
			},
		],
	},
	{
		displayName: 'Messages',
		name: 'messagesJson',
		type: 'json',
		default: '[{"role": "user", "content": ""}]',
		required: true,
		description:
			'Conversation history as a JSON array of OpenAI-style messages (`role`, `content`, and optionally `tool_calls` / `tool_call_id`). Content may be a string or a content-parts array (`text`, `image_url` with a base64 data URL, `file` with a workspace file_id).',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chatCompletions'],
				messagesInput: ['json'],
			},
		},
	},
	{
		displayName: 'Stream',
		name: 'stream',
		type: 'boolean',
		default: false,
		description:
			'Whether to receive the response as Server-Sent Events. When off (the default), a single JSON chat completion is returned once generation finishes.',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chatCompletions'],
			},
		},
	},
	{
		displayName: 'Simplify Output',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to return the assistant message content (and tool calls, if any) instead of the full OpenAI chat completion object — or, when Stream is on, instead of one item per SSE chunk',
		displayOptions: {
			show: {
				resource: ['service'],
				operation: ['chatCompletions'],
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
				operation: ['chatCompletions'],
			},
		},
		options: [
			{
				displayName: 'Extra Parameters (JSON)',
				name: 'extraParameters',
				type: 'json',
				default: '{}',
				description: 'Other OpenAI fields forwarded as-is. Merged over the named fields below.',
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
				displayName: 'Top P',
				name: 'topP',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
				default: 1,
				description: 'Nucleus sampling probability mass',
			},
		],
	},
];
