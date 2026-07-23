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
	if (filters.select) {
		qs.select = filters.select;
	}
	if (sort.field) {
		qs.field = sort.field;
	}
	if (sort.order) {
		qs.order = sort.order;
	}

	const endpoint = `/workspaces/${workspaceName}/indexes`;
	const limit = returnAll ? 100 : (this.getNodeParameter('limit', itemIndex) as number);

	if (!returnAll && (filters.before || filters.after)) {
		// `before`/`after` are mutually exclusive with `page_number` per the API
		// docs ("To use this option, clear the page_number parameter first") —
		// bypass fetchPaginatedResults() (which always sends page_number) and
		// query directly instead.
		if (filters.before) qs.before = filters.before;
		if (filters.after) qs.after = filters.after;
		const response = await apiRequest.call(this, 'GET', endpoint, { qs: { ...qs, limit } });
		return extractPaginatedList(response);
	}

	return fetchPaginatedResults(this, endpoint, qs, returnAll, limit, extractPaginatedList);
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
