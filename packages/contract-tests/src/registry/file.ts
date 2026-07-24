import { executeFile } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/file/File.execute';
import type { ContractResourceSuite } from './types';
import { CONTRACT_TEST_UUID } from './caseFactories';

const CONTRACT_TEST_FILE_ID = CONTRACT_TEST_UUID;

/**
 * `get` (the arraybuffer file download) isn't in this registry — and can't be
 * made meaningfully testable just by extending the test harness. The spec declares
 * this endpoint's 200 response as `application/json` with an *empty* schema (`{}`),
 * not a real binary/octet-stream declaration — because the real endpoint
 * returns a raw streaming/file response FastAPI's OpenAPI generator can't
 * introspect a concrete schema for, so it fell back to a generic placeholder.
 * That means Prism can only ever mock back some generic JSON-shaped stand-in
 * for this response, never real file bytes, no matter what the test harness
 * does — so there's nothing to meaningfully validate the actual
 * binary-to-n8n-binary-property conversion path against. Revisit only if the
 * spec ever documents this response's real content type.
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
			// No optional query params at all — the most common real-world call
			// shape, since most users won't touch Filters/Sort.
			operation: 'getAll',
			description: 'GET /files (no optional query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
			},
		},
		{
			// Also exercises `name`/`content`/`filter`/`field`/`order` — `field`/
			// `order` have enum constraints in the spec, so a wrong value here
			// would actually fail against Prism.
			operation: 'getAll',
			description: 'GET /files (with name + content + filter + sort query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { name: 'contract-test.txt', content: 'hello', odataFilter: "name eq 'contract-test.txt'" },
				sort: { field: 'name', order: 'ASC' },
			},
		},
		{
			// Manual after_value/after_file_id cursor for a single (non-Return-All)
			// query — distinct from the automatic cursor-walk Return All uses
			// internally (see Index's before/after cases for the analogous check).
			operation: 'getAll',
			description: 'GET /files (with after_value/after_file_id cursor)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: { afterValue: '2024-01-02T00:00:00.000000+00:00', afterFileId: CONTRACT_TEST_FILE_ID },
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
				'filesMetadata.file': [{ fileId: CONTRACT_TEST_FILE_ID, metadata: '{"category":"contract-test"}' }],
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
