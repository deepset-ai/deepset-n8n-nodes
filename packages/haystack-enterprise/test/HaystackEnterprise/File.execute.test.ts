import { describe, expect, it, vi } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import { executeFile } from '../../nodes/HaystackEnterprise/resources/file/File.execute';
import { createExecuteContext as createContext } from './testHelpers';

describe('executeFile — upload', () => {
	it('uploads text content, sending the file name and write mode as query params', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				uploadFrom: 'textContent',
				writeMode: 'overwrite',
				metadata: '{"source":"api"}',
				text: 'hello world',
				fileName: 'note.txt',
			},
			async () => ({ file_id: 'f1' }),
		);

		const result = await executeFile.call(context, 'upload', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, options] = httpRequestWithAuthentication.mock.calls[0] as [
			string,
			{ url: string; qs: Record<string, unknown>; body: FormData; json: boolean },
		];
		expect(options.url).toContain('/workspaces/ws/files');
		expect(options.json).toBe(false);
		expect(options.qs).toEqual({ write_mode: 'overwrite', file_name: 'note.txt' });
		expect(options.body).toBeInstanceOf(FormData);
		expect(options.body.get('meta')).toBe('{"source":"api"}');
		expect(options.body.get('text')).toBe('hello world');
		expect(result).toEqual([{ json: { file_id: 'f1' } }]);
	});

	it('defaults metadata to {} when left empty', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				uploadFrom: 'textContent',
				writeMode: 'overwrite',
				text: 'hi',
				fileName: 'note.txt',
			},
			async () => ({ file_id: 'f1' }),
		);

		await executeFile.call(context, 'upload', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as [string, { body: FormData }];
		expect(options.body.get('meta')).toBe('{}');
	});

	it('uploads binary data as a file, falling back to "file" when the binary data has no filename', async () => {
		const assertBinaryData = vi.fn(() => ({ mimeType: 'application/pdf', fileName: '' }));
		const getBinaryDataBuffer = vi.fn(async () => Buffer.from('binary-content'));
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				uploadFrom: 'binaryData',
				writeMode: 'overwrite',
				metadata: '{}',
				binaryPropertyName: 'data',
			},
			async () => ({ file_id: 'f1' }),
			{ assertBinaryData, getBinaryDataBuffer },
		);

		await executeFile.call(context, 'upload', 0);

		expect(assertBinaryData).toHaveBeenCalledWith(0, 'data');
		expect(getBinaryDataBuffer).toHaveBeenCalledWith(0, 'data');
		const [, options] = httpRequestWithAuthentication.mock.calls[0] as [string, { body: FormData }];
		const uploaded = options.body.get('file') as File;
		expect(uploaded.name).toBe('file');
		expect(uploaded.type).toBe('application/pdf');
		expect(await uploaded.text()).toBe('binary-content');
	});

	it("uses the binary data's own filename when present", async () => {
		const assertBinaryData = vi.fn(() => ({ mimeType: 'application/pdf', fileName: 'doc.pdf' }));
		const getBinaryDataBuffer = vi.fn(async () => Buffer.from('binary-content'));
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				uploadFrom: 'binaryData',
				writeMode: 'overwrite',
				metadata: '{}',
				binaryPropertyName: 'data',
			},
			async () => ({ file_id: 'f1' }),
			{ assertBinaryData, getBinaryDataBuffer },
		);

		await executeFile.call(context, 'upload', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as [string, { body: FormData }];
		expect((options.body.get('file') as File).name).toBe('doc.pdf');
	});
});

describe('executeFile — get many', () => {
	it('returns a single page when Return All is off, without a cursor', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', returnAll: false, limit: 50, filters: {}, sort: {} },
			async () => ({ data: [{ file_id: 'a' }, { file_id: 'b' }], has_more: true, total: 10 }),
		);

		const result = await executeFile.call(context, 'getAll', 0);

		expect(result).toEqual([{ json: { file_id: 'a' } }, { json: { file_id: 'b' } }]);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
		const [, options] = httpRequestWithAuthentication.mock.calls[0] as [
			string,
			{ qs: Record<string, unknown> },
		];
		expect(options.qs).not.toHaveProperty('page_number');
	});

	it('pages through results via the after_value/after_file_id cursor when Return All is on', async () => {
		let call = 0;
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', returnAll: true, filters: {}, sort: {} },
			async (_cred: string, options: { qs: Record<string, unknown> }) => {
				call += 1;
				if (call === 1) {
					return {
						data: [
							{ file_id: 'f1', created_at: '2024-01-01' },
							{ file_id: 'f2', created_at: '2024-01-02' },
						],
						has_more: true,
						total: 3,
					};
				}
				expect(options.qs).toMatchObject({ after_value: '2024-01-02', after_file_id: 'f2' });
				return { data: [{ file_id: 'f3', created_at: '2024-01-03' }], has_more: false, total: 3 };
			},
		);

		const result = await executeFile.call(context, 'getAll', 0);

		expect(result.map((item) => item.json.file_id)).toEqual(['f1', 'f2', 'f3']);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});

	it('stops paginating once a page comes back empty, even if the server still reports has_more: true', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', returnAll: true, filters: {}, sort: {} },
			async () => ({ data: [], has_more: true, total: 0 }),
		);

		const result = await executeFile.call(context, 'getAll', 0);

		expect(result).toEqual([]);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(1);
	});

	it('uses the chosen sort field as the cursor key instead of the created_at default', async () => {
		let call = 0;
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', returnAll: true, filters: {}, sort: { field: 'name' } },
			async (_cred: string, options: { qs: Record<string, unknown> }) => {
				call += 1;
				if (call === 1) {
					return { data: [{ file_id: 'f1', name: 'alpha' }], has_more: true, total: 2 };
				}
				expect(options.qs).toMatchObject({ after_value: 'alpha', after_file_id: 'f1' });
				return { data: [{ file_id: 'f2', name: 'beta' }], has_more: false, total: 2 };
			},
		);

		await executeFile.call(context, 'getAll', 0);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});

	it('passes a manual after_value/after_file_id cursor as query params when Return All is off', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				returnAll: false,
				limit: 50,
				filters: { afterValue: '2024-01-02', afterFileId: 'f2' },
				sort: {},
			},
			async () => ({ data: [{ file_id: 'f3' }], has_more: false, total: 1 }),
		);

		const result = await executeFile.call(context, 'getAll', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as [
			string,
			{ qs: Record<string, unknown> },
		];
		expect(options.qs).toMatchObject({ after_value: '2024-01-02', after_file_id: 'f2' });
		expect(result).toEqual([{ json: { file_id: 'f3' } }]);
	});

	it('omits after_value/after_file_id entirely when only one of the pair is provided', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				returnAll: false,
				limit: 50,
				filters: { afterValue: '2024-01-02' },
				sort: {},
			},
			async () => ({ data: [{ file_id: 'f1' }], has_more: false, total: 1 }),
		);

		await executeFile.call(context, 'getAll', 0);

		const [, options] = httpRequestWithAuthentication.mock.calls[0] as [
			string,
			{ qs: Record<string, unknown> },
		];
		expect(options.qs).not.toHaveProperty('after_value');
		expect(options.qs).not.toHaveProperty('after_file_id');
	});

	it('ignores a manual after_value/after_file_id cursor when Return All is on', async () => {
		let call = 0;
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				returnAll: true,
				filters: { afterValue: 'manual-value', afterFileId: 'manual-id' },
				sort: {},
			},
			async (_cred: string, options: { qs: Record<string, unknown> }) => {
				call += 1;
				if (call === 1) {
					expect(options.qs).not.toHaveProperty('after_value');
					expect(options.qs).not.toHaveProperty('after_file_id');
					return { data: [{ file_id: 'f1', created_at: '2024-01-01' }], has_more: true, total: 2 };
				}
				expect(options.qs).toMatchObject({ after_value: '2024-01-01', after_file_id: 'f1' });
				return { data: [{ file_id: 'f2', created_at: '2024-01-02' }], has_more: false, total: 2 };
			},
		);

		await executeFile.call(context, 'getAll', 0);
		expect(httpRequestWithAuthentication).toHaveBeenCalledTimes(2);
	});
});

describe('executeFile — get', () => {
	it('returns the file content as text when Output Format is text', async () => {
		const { context } = createContext(
			{ workspaceName: 'ws', fileId: 'f1', outputFormat: 'text' },
			async () => ({ body: Buffer.from('hello file'), headers: {} }),
		);

		const result = await executeFile.call(context, 'get', 0);

		expect(result).toEqual([{ json: { fileId: 'f1', content: 'hello file' } }]);
	});

	it('converts a raw ArrayBuffer response body to a Buffer before reading it as text', async () => {
		const source = Buffer.from('array-buffer content');
		const arrayBuffer = source.buffer.slice(
			source.byteOffset,
			source.byteOffset + source.byteLength,
		);
		const { context } = createContext(
			{ workspaceName: 'ws', fileId: 'f1', outputFormat: 'text' },
			async () => ({ body: arrayBuffer, headers: {} }),
		);

		const result = await executeFile.call(context, 'get', 0);

		expect(result).toEqual([{ json: { fileId: 'f1', content: 'array-buffer content' } }]);
	});

	it('returns the file as binary data, forwarding the response content-type', async () => {
		const prepareBinaryData = vi.fn(
			async (buffer: Buffer, _mime: unknown, contentType?: string) => ({
				data: buffer.toString('base64'),
				mimeType: contentType,
				fileName: 'f1',
			}),
		);
		const { context } = createContext(
			{ workspaceName: 'ws', fileId: 'f1', outputFormat: 'binary', binaryPropertyName: 'data' },
			async () => ({
				body: Buffer.from('pdf-bytes'),
				headers: { 'content-type': 'application/pdf' },
			}),
			{ prepareBinaryData },
		);

		const result = await executeFile.call(context, 'get', 0);

		expect(prepareBinaryData).toHaveBeenCalledWith(
			Buffer.from('pdf-bytes'),
			undefined,
			'application/pdf',
		);
		expect(result).toEqual([
			{
				json: { fileId: 'f1' },
				binary: {
					data: {
						data: Buffer.from('pdf-bytes').toString('base64'),
						mimeType: 'application/pdf',
						fileName: 'f1',
					},
				},
			},
		]);
	});
});

describe('executeFile — get meta / update meta', () => {
	it("fetches a file's metadata by ID", async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', fileId: 'f1' },
			async () => ({ source: 'api' }),
		);

		const result = await executeFile.call(context, 'getMeta', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				method: 'GET',
				url: expect.stringContaining('/workspaces/ws/files/f1/meta'),
			}),
		);
		expect(result).toEqual([{ json: { source: 'api' } }]);
	});

	it('patches parsed metadata for a single file', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', fileId: 'f1', metadata: '{"source":"updated"}' },
			async () => ({}),
		);

		const result = await executeFile.call(context, 'updateMeta', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				method: 'PATCH',
				url: expect.stringContaining('/workspaces/ws/files/f1/meta'),
				body: { source: 'updated' },
			}),
		);
		expect(result).toEqual([{ json: { fileId: 'f1', success: true } }]);
	});

	it('rejects invalid JSON metadata with a NodeOperationError naming the field', async () => {
		const { context } = createContext(
			{ workspaceName: 'ws', fileId: 'f1', metadata: '{not valid' },
			async () => ({}),
		);

		await expect(executeFile.call(context, 'updateMeta', 0)).rejects.toThrow(NodeOperationError);
	});
});

describe('executeFile — update meta bulk', () => {
	it('sends parsed metadata keyed by file ID, skipping entries without a file ID', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{
				workspaceName: 'ws',
				'filesMetadata.file': [
					{ fileId: 'f1', metadata: '{"a":1}' },
					{ fileId: '', metadata: '{"b":2}' },
					{ fileId: 'f2', metadata: '{"c":3}' },
				],
			},
			async () => ({ updated: 2 }),
		);

		const result = await executeFile.call(context, 'updateMetaBulk', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				method: 'POST',
				url: expect.stringContaining('/workspaces/ws/files/update-meta'),
				body: { f1: { a: 1 }, f2: { c: 3 } },
			}),
		);
		expect(result).toEqual([{ json: { updated: 2 } }]);
	});

	it('defaults to an empty list when no entries are provided', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws' },
			async () => ({}),
		);

		await executeFile.call(context, 'updateMetaBulk', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({ body: {} }),
		);
	});
});

describe('executeFile — delete / delete many', () => {
	it('deletes a single file by ID', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', fileId: 'f1' },
			async () => ({}),
		);

		const result = await executeFile.call(context, 'delete', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({
				method: 'DELETE',
				url: expect.stringContaining('/workspaces/ws/files/f1'),
			}),
		);
		expect(result).toEqual([{ json: { fileId: 'f1', success: true } }]);
	});

	it('deletes only the named files when a comma-separated list is given', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', names: 'a.pdf, b.pdf', deleteAll: false },
			async () => ({}),
		);

		const result = await executeFile.call(context, 'deleteMany', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({ method: 'DELETE', body: { names: ['a.pdf', 'b.pdf'] } }),
		);
		expect(result).toEqual([{ json: { deletedNames: ['a.pdf', 'b.pdf'], success: true } }]);
	});

	it('deletes every file in the workspace when Delete All Files is enabled', async () => {
		const { context, httpRequestWithAuthentication } = createContext(
			{ workspaceName: 'ws', names: '', deleteAll: true },
			async () => ({}),
		);

		const result = await executeFile.call(context, 'deleteMany', 0);

		expect(httpRequestWithAuthentication).toHaveBeenCalledWith(
			'haystackEnterpriseApi',
			expect.objectContaining({ method: 'DELETE', body: { names: [] } }),
		);
		expect(result).toEqual([{ json: { deletedNames: 'all', success: true } }]);
	});

	it('refuses to delete anything when no names are given and Delete All Files is off', async () => {
		const { context } = createContext(
			{ workspaceName: 'ws', names: '', deleteAll: false },
			async () => ({}),
		);

		await expect(executeFile.call(context, 'deleteMany', 0)).rejects.toThrow(/Delete All Files/);
	});
});
