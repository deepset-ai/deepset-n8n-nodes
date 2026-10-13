import type { ContractResourceSuite } from './types';

import { executeFile } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/file/File.execute';
import { CONTRACT_TEST_UUID } from './caseFactories';

const CONTRACT_TEST_FILE_ID = CONTRACT_TEST_UUID;

/**
 * `get` (file download) is not covered: the spec declares its 200 response as JSON with an
 * empty schema, so Prism can't mock real file bytes.
 */
export const fileSuite: ContractResourceSuite = {
	resource: 'file',
	handler: executeFile,
	cases: [
		{
			operation: 'upload',
			description: 'POST /files (text content)',
			params: {
				workspaceName: 'contract-test-workspace',
				uploadFrom: 'textContent',
				writeMode: 'KEEP',
				metadata: '{"category":"contract-test"}',
				text: 'hello from a contract test',
				fileName: 'contract-test.txt',
			},
		},
		{
			// No optional query params.
			operation: 'getAll',
			description: 'GET /files (no optional query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
			},
		},
		{
			// `field`/`order` are enums in the spec, so invalid values fail against Prism.
			operation: 'getAll',
			description: 'GET /files (with name + content + filter + sort query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: {
					name: 'contract-test.txt',
					content: 'hello',
					odataFilter: "name eq 'contract-test.txt'",
				},
				sort: { field: 'name', order: 'ASC' },
			},
		},
		{
			// Manual cursor for a single (non-Return-All) query.
			operation: 'getAll',
			description: 'GET /files (with after_value/after_file_id cursor)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: {
					afterValue: '2024-01-02T00:00:00.000000+00:00',
					afterFileId: CONTRACT_TEST_FILE_ID,
				},
			},
		},
		{
			operation: 'getMeta',
			description: 'GET /files/{file_id}/meta',
			params: {
				workspaceName: 'contract-test-workspace',
				fileId: CONTRACT_TEST_FILE_ID,
			},
		},
		{
			operation: 'updateMeta',
			description: 'PATCH /files/{file_id}/meta',
			params: {
				workspaceName: 'contract-test-workspace',
				fileId: CONTRACT_TEST_FILE_ID,
				metadata: '{"category":"contract-test"}',
			},
		},
		{
			operation: 'updateMetaBulk',
			description: 'POST /files/update-meta',
			params: {
				workspaceName: 'contract-test-workspace',
				'filesMetadata.file': [
					{ fileId: CONTRACT_TEST_FILE_ID, metadata: '{"category":"contract-test"}' },
				],
			},
		},
		{
			operation: 'delete',
			description: 'DELETE /files/{file_id}',
			params: {
				workspaceName: 'contract-test-workspace',
				fileId: CONTRACT_TEST_FILE_ID,
			},
		},
		{
			operation: 'deleteMany',
			description: 'DELETE /files',
			params: {
				workspaceName: 'contract-test-workspace',
				names: '',
				deleteAll: true,
			},
		},
	],
};
