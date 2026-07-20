import type { INodeProperties } from 'n8n-workflow';

const DOCS_BASE_URL = 'https://docs.cloud.deepset.ai/docs/api/main';

const apiDocsNotice = (operation: string, urlSlug: string): INodeProperties => ({
	displayName: `See the <a href="${DOCS_BASE_URL}/${urlSlug}" target="_blank">Haystack Enterprise API docs</a> for this endpoint`,
	name: `apiDocsNotice_${operation}`,
	type: 'notice',
	default: '',
	displayOptions: {
		show: {
			resource: ['file'],
			operation: [operation],
		},
	},
});

export const fileOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['file'],
			},
		},
		options: [
			{ name: 'Delete', value: 'delete', description: 'Delete a file by ID', action: 'Delete a file' },
			{
				name: 'Delete Many',
				value: 'deleteMany',
				description: 'Delete files by name, or all files in the workspace',
				action: 'Delete many files',
			},
			{ name: 'Get', value: 'get', description: 'Get the contents of a file', action: 'Get a file' },
			{ name: 'Get Many', value: 'getAll', description: 'List files in a workspace', action: 'Get many files' },
			{ name: 'Get Meta', value: 'getMeta', description: 'Get the metadata of a file', action: 'Get file metadata' },
			{
				name: 'Query (SQL)',
				value: 'query',
				description: 'Run an OpenSearch SQL query against the file index',
				action: 'Query files with SQL',
			},
			{
				name: 'Search',
				value: 'search',
				description: 'Run an OpenSearch DSL query against the file index',
				action: 'Search files',
			},
			{
				name: 'Update Meta',
				value: 'updateMeta',
				description: 'Update the metadata of a file',
				action: 'Update file metadata',
			},
			{
				name: 'Update Meta Bulk',
				value: 'updateMetaBulk',
				description: 'Update the metadata of multiple files at once',
				action: 'Update metadata for multiple files',
			},
			{ name: 'Upload', value: 'upload', description: 'Upload a file, or create a text file', action: 'Upload a file' },
		],
		default: 'getAll',
	},
];

const fileIdField = (operation: string): INodeProperties => ({
	displayName: 'File Name or ID',
	name: 'fileId',
	type: 'options',
	typeOptions: {
		loadOptionsMethod: 'getFiles',
		loadOptionsDependsOn: ['workspaceName'],
	},
	default: '',
	required: true,
	description:
		'The file to use. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	displayOptions: {
		show: {
			resource: ['file'],
			operation: [operation],
		},
	},
});

export const fileFields: INodeProperties[] = [
	// Upload
	apiDocsNotice('upload', 'upload-file-api-v-1-workspaces-workspace-name-files-post'),
	{
		displayName: 'Upload From',
		name: 'uploadFrom',
		type: 'options',
		options: [
			{ name: 'Binary Data', value: 'binaryData' },
			{ name: 'Text Content', value: 'textContent' },
		],
		default: 'binaryData',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['upload'],
			},
		},
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		description: 'Name of the binary property that contains the file to upload',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['upload'],
				uploadFrom: ['binaryData'],
			},
		},
	},
	{
		displayName: 'Text Content',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		required: true,
		description: 'The text content to upload as a file',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['upload'],
				uploadFrom: ['textContent'],
			},
		},
	},
	{
		displayName: 'File Name',
		name: 'fileName',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. notes.txt',
		description: 'Name of the file to create',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['upload'],
				uploadFrom: ['textContent'],
			},
		},
	},
	{
		displayName: 'Write Mode',
		name: 'writeMode',
		type: 'options',
		options: [
			{ name: 'Keep', value: 'KEEP', description: 'Keep both files if a file with the same name already exists' },
			{ name: 'Overwrite', value: 'OVERWRITE', description: 'Overwrite all files with the same name' },
			{ name: 'Fail', value: 'FAIL', description: 'Fail if a file with the same name already exists' },
		],
		default: 'KEEP',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['upload'],
			},
		},
	},
	{
		displayName: 'Metadata',
		name: 'metadata',
		type: 'json',
		default: '{}',
		description: 'Metadata to attach to the file, as a JSON object. Usable as filters during search.',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['upload'],
			},
		},
	},
	// Get Many
	apiDocsNotice('getAll', 'list-files-api-v-1-workspaces-workspace-name-files-get'),
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: {
			show: {
				resource: ['file'],
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
				resource: ['file'],
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
				resource: ['file'],
				operation: ['getAll'],
			},
		},
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Filter by the exact file name',
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				default: '',
				description: 'Filter by file content',
			},
			{
				displayName: 'OData Filter',
				name: 'odataFilter',
				type: 'string',
				default: '',
				placeholder: "e.g. category eq 'news' and published_date ge '2025-01-01'",
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
				resource: ['file'],
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
				default: 'ASC',
			},
		],
	},
	// Get
	apiDocsNotice('get', 'get-file-api-v-1-workspaces-workspace-name-files-file-id-get'),
	fileIdField('get'),
	{
		displayName: 'Output Format',
		name: 'outputFormat',
		type: 'options',
		options: [
			{ name: 'Binary Data', value: 'binary' },
			{ name: 'Text', value: 'text' },
		],
		default: 'binary',
		description: 'Whether to return the file as binary data (works for any file type) or as plain text',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['get'],
			},
		},
	},
	{
		displayName: 'Put Output In Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		description: 'Name of the binary property to write the file contents to',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['get'],
				outputFormat: ['binary'],
			},
		},
	},
	// Get Meta
	apiDocsNotice('getMeta', 'get-file-meta-api-v-1-workspaces-workspace-name-files-file-id-meta-get'),
	fileIdField('getMeta'),
	// Update Meta
	apiDocsNotice('updateMeta', 'update-file-meta-api-v-1-workspaces-workspace-name-files-file-id-meta-patch'),
	fileIdField('updateMeta'),
	{
		displayName: 'Metadata',
		name: 'metadata',
		type: 'json',
		default: '{}',
		required: true,
		description:
			'Metadata to merge into the existing metadata, as a JSON object. Set a key\'s value to null to delete that key.',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['updateMeta'],
			},
		},
	},
	// Update Meta Bulk
	apiDocsNotice('updateMetaBulk', 'update-file-meta-bulk-api-v-1-workspaces-workspace-name-files-update-meta-post'),
	{
		displayName: 'Files',
		name: 'filesMetadata',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add File',
		default: {},
		required: true,
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['updateMetaBulk'],
			},
		},
		options: [
			{
				displayName: 'File',
				name: 'file',
				values: [
					{
						displayName: 'File Name or ID',
						name: 'fileId',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: 'getFiles',
							loadOptionsDependsOn: ['workspaceName'],
						},
						default: '',
						description:
							'The file to update. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Metadata',
						name: 'metadata',
						type: 'json',
						default: '{}',
						description: "Metadata to merge into the file's existing metadata, as a JSON object",
					},
				],
			},
		],
	},
	// Delete
	apiDocsNotice('delete', 'delete-file-api-v-1-workspaces-workspace-name-files-file-id-delete'),
	fileIdField('delete'),
	// Delete Many
	apiDocsNotice('deleteMany', 'delete-files-api-v-1-workspaces-workspace-name-files-delete'),
	{
		displayName: 'File Names',
		name: 'names',
		type: 'string',
		default: '',
		placeholder: 'e.g. report.pdf, notes.txt',
		description: 'Comma-separated list of file names to delete. Leave empty and enable "Delete All Files" to delete every file in the workspace.',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['deleteMany'],
			},
		},
	},
	{
		displayName: 'Delete All Files',
		name: 'deleteAll',
		type: 'boolean',
		default: false,
		description: 'Whether to delete every file in the workspace. Required to be enabled when File Names is empty, as a safety guard against accidental deletion.',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['deleteMany'],
			},
		},
	},
	// Search
	apiDocsNotice('search', 'search-files-api-v-1-workspaces-workspace-name-files-search-post'),
	{
		displayName: 'Query (JSON)',
		name: 'query',
		type: 'json',
		default: '',
		required: true,
		placeholder: '{\n  "query": {\n    "match": {\n      "name": "invoice"\n    }\n  }\n}',
		description:
			'An OpenSearch Query DSL query to run against the file index. See the <a href="https://opensearch.org/docs/latest/query-dsl/">OpenSearch Query DSL docs</a>.',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['search'],
			},
		},
	},
	// Query (SQL)
	apiDocsNotice('query', 'query-files-api-v-1-workspaces-workspace-name-files-sql-post'),
	{
		displayName: 'SQL Query',
		name: 'sqlQuery',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		placeholder: 'SELECT * FROM file WHERE name LIKE \'%invoice%\'',
		description:
			'An OpenSearch SQL query. The table must be called `file`. See the <a href="https://docs.opensearch.org/latest/search-plugins/sql/sql/index/">OpenSearch SQL syntax docs</a>.',
		displayOptions: {
			show: {
				resource: ['file'],
				operation: ['query'],
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
				resource: ['file'],
				operation: ['query'],
			},
		},
		options: [
			{
				displayName: 'Cursor',
				name: 'cursor',
				type: 'string',
				default: '',
				description: 'A cursor from a previous response, to page through results',
			},
			{
				displayName: 'Fetch Size',
				name: 'fetchSize',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 100,
				description: 'Number of results to return per page',
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'string',
				default: '',
				placeholder: 'e.g. jdbc, csv, raw',
				description: 'The response format. See the OpenSearch response formats docs.',
			},
		],
	},
];
