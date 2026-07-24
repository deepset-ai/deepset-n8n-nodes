import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest, extractPaginatedList, parseJsonField } from '../../utils';

async function upload(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const uploadFrom = this.getNodeParameter('uploadFrom', itemIndex) as string;
	const writeMode = this.getNodeParameter('writeMode', itemIndex) as string;
	const metadata =
		parseJsonField.call(this, itemIndex, 'Metadata', this.getNodeParameter('metadata', itemIndex, '{}')) ?? {};

	const formData = new FormData();
	formData.append('meta', JSON.stringify(metadata));

	const qs: IDataObject = { write_mode: writeMode };

	if (uploadFrom === 'textContent') {
		const text = this.getNodeParameter('text', itemIndex) as string;
		const fileName = this.getNodeParameter('fileName', itemIndex) as string;
		formData.append('text', text);
		qs.file_name = fileName;
	} else {
		const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
		const binaryData = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
		const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
		formData.append(
			'file',
			new Blob([new Uint8Array(buffer)], { type: binaryData.mimeType }),
			binaryData.fileName || 'file',
		);
	}

	return (await apiRequest.call(this, 'POST', `/workspaces/${workspaceName}/files`, {
		body: formData,
		qs,
		json: false,
	})) as IDataObject;
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const sort = this.getNodeParameter('sort', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {};
	if (filters.name) qs.name = filters.name;
	if (filters.content) qs.content = filters.content;
	if (filters.odataFilter) qs.filter = filters.odataFilter;
	if (sort.field) qs.field = sort.field;
	if (sort.order) qs.order = sort.order;
	const sortField = (sort.field as string) || 'created_at';

	if (!returnAll) {
		const limit = this.getNodeParameter('limit', itemIndex) as number;
		// Manual after_value/after_file_id only apply to a single query — Return
		// All manages its own cursor internally (see the loop below), so these
		// are left out of `qs` there to avoid fighting over the same params.
		// The API only accepts them together — sending just one is likely to
		// 422 — so only include either if both are actually set.
		const hasAfterValue = filters.afterValue !== undefined && filters.afterValue !== '';
		const hasAfterFileId = filters.afterFileId !== undefined && filters.afterFileId !== '';
		if (hasAfterValue && hasAfterFileId) {
			qs.after_value = filters.afterValue;
			qs.after_file_id = filters.afterFileId;
		}
		const response = await apiRequest.call(this, 'GET', `/workspaces/${workspaceName}/files`, {
			qs: { ...qs, limit },
		});
		return extractPaginatedList(response);
	}

	const files: IDataObject[] = [];
	let cursor: IDataObject | undefined;
	let hasMore = true;
	while (hasMore) {
		const response = (await apiRequest.call(this, 'GET', `/workspaces/${workspaceName}/files`, {
			qs: {
				...qs,
				limit: 100,
				...cursor,
			},
		})) as IDataObject;
		const page = extractPaginatedList(response);
		files.push(...page);
		hasMore = response.has_more === true;
		const last = page[page.length - 1];
		if (hasMore && last) {
			cursor = { after_value: last[sortField], after_file_id: last.file_id };
		} else {
			hasMore = false;
		}
	}

	return files;
}

async function get(this: IExecuteFunctions, itemIndex: number): Promise<INodeExecutionData> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const fileId = this.getNodeParameter('fileId', itemIndex) as string;
	const outputFormat = this.getNodeParameter('outputFormat', itemIndex) as string;

	const response = (await apiRequest.call(this, 'GET', `/workspaces/${workspaceName}/files/${fileId}`, {
		json: false,
		encoding: 'arraybuffer',
		returnFullResponse: true,
	})) as { body: ArrayBuffer | Buffer; headers: IDataObject };

	const buffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);

	if (outputFormat === 'text') {
		return { json: { fileId, content: buffer.toString('utf-8') } };
	}

	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const contentType =
		typeof response.headers['content-type'] === 'string' ? (response.headers['content-type'] as string) : undefined;
	const binaryData = await this.helpers.prepareBinaryData(buffer, undefined, contentType);
	return { json: { fileId }, binary: { [binaryPropertyName]: binaryData } };
}

async function getMeta(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const fileId = this.getNodeParameter('fileId', itemIndex) as string;
	return (await apiRequest.call(this, 'GET', `/workspaces/${workspaceName}/files/${fileId}/meta`)) as IDataObject;
}

async function updateMeta(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const fileId = this.getNodeParameter('fileId', itemIndex) as string;
	const metadata = parseJsonField.call(this, itemIndex, 'Metadata', this.getNodeParameter('metadata', itemIndex)) ?? {};

	await apiRequest.call(this, 'PATCH', `/workspaces/${workspaceName}/files/${fileId}/meta`, { body: metadata });
	return { fileId, success: true };
}

async function updateMetaBulk(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const filesMetadata = this.getNodeParameter('filesMetadata.file', itemIndex, []) as Array<{
		fileId: string;
		metadata: string;
	}>;

	const body: IDataObject = {};
	for (const entry of filesMetadata) {
		if (!entry.fileId) continue;
		body[entry.fileId] = parseJsonField.call(this, itemIndex, 'Metadata', entry.metadata) ?? {};
	}

	return (await apiRequest.call(this, 'POST', `/workspaces/${workspaceName}/files/update-meta`, {
		body,
	})) as IDataObject;
}

async function deleteFile(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const fileId = this.getNodeParameter('fileId', itemIndex) as string;
	await apiRequest.call(this, 'DELETE', `/workspaces/${workspaceName}/files/${fileId}`);
	return { fileId, success: true };
}

async function deleteMany(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const namesInput = this.getNodeParameter('names', itemIndex, '') as string;
	const deleteAll = this.getNodeParameter('deleteAll', itemIndex) as boolean;

	const names = namesInput
		.split(',')
		.map((name) => name.trim())
		.filter((name) => name.length > 0);

	if (names.length === 0 && !deleteAll) {
		throw new NodeOperationError(
			this.getNode(),
			'"File Names" is empty. To delete every file in the workspace, enable "Delete All Files" explicitly.',
			{ itemIndex },
		);
	}

	// The API's `names` field is required — an empty array tells it to delete every file in the workspace.
	await apiRequest.call(this, 'DELETE', `/workspaces/${workspaceName}/files`, { body: { names } });
	return { deletedNames: names.length > 0 ? names : 'all', success: true };
}

export async function executeFile(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'get') {
		return [await get.call(this, itemIndex)];
	}

	let result: IDataObject | IDataObject[];
	switch (operation) {
		case 'upload':
			result = await upload.call(this, itemIndex);
			break;
		case 'getAll':
			result = await getAll.call(this, itemIndex);
			break;
		case 'getMeta':
			result = await getMeta.call(this, itemIndex);
			break;
		case 'updateMeta':
			result = await updateMeta.call(this, itemIndex);
			break;
		case 'updateMetaBulk':
			result = await updateMetaBulk.call(this, itemIndex);
			break;
		case 'delete':
			result = await deleteFile.call(this, itemIndex);
			break;
		case 'deleteMany':
			result = await deleteMany.call(this, itemIndex);
			break;
		default:
			throw new NodeOperationError(this.getNode(), `Unknown File operation: ${operation}`, { itemIndex });
	}

	const items = Array.isArray(result) ? result : [result];
	return items.map((json) => ({ json }));
}
