import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { apiRequest, extractPaginatedList, fetchPaginatedResults } from '../../utils';

async function get(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const indexName = this.getNodeParameter('indexName', itemIndex) as string;

	return (await apiRequest.call(
		this,
		'GET',
		`/workspaces/${workspaceName}/indexes/${indexName}`,
	)) as IDataObject;
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const sort = this.getNodeParameter('sort', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {};
	if (filters.odataFilter) {
		qs.filter = filters.odataFilter;
	}
	if (sort.field) {
		qs.field = sort.field;
	}
	if (sort.order) {
		qs.order = sort.order;
	}

	const limit = returnAll ? 100 : (this.getNodeParameter('limit', itemIndex) as number);
	return fetchPaginatedResults(this, `/workspaces/${workspaceName}/indexes`, qs, returnAll, limit, extractPaginatedList);
}

export async function executeIndex(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	let result: IDataObject | IDataObject[];
	switch (operation) {
		case 'get':
			result = await get.call(this, itemIndex);
			break;
		case 'getAll':
			result = await getAll.call(this, itemIndex);
			break;
		default:
			throw new Error(`Unknown Index operation: ${operation}`);
	}

	const items = Array.isArray(result) ? result : [result];
	return items.map((json) => ({ json }));
}
