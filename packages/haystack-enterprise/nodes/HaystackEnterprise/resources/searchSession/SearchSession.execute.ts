import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest, createSearchSession, extractSearchSessionList, fetchListWithCursorOrPaging } from '../../utils';

async function create(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const deploymentId = this.getNodeParameter('deploymentId', itemIndex) as string;

	const searchSessionId = await createSearchSession.call(this, workspaceName, deploymentId);
	return { search_session_id: searchSessionId };
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;

	// Sessions can still be owned by a pipeline instead of a service/deployment
	// (search_session.deployment_id is nullable). Create only makes deployment-owned
	// sessions now, so Get Many hides the pipeline-owned leftovers by default.
	const qs: IDataObject = {
		filter: filters.odataFilter ? `deployment_id ne null and (${filters.odataFilter})` : 'deployment_id ne null',
	};

	const limit = returnAll ? 100 : (this.getNodeParameter('limit', itemIndex) as number);

	return fetchListWithCursorOrPaging(
		this,
		`/workspaces/${workspaceName}/search_sessions`,
		qs,
		returnAll,
		limit,
		filters,
		extractSearchSessionList,
	);
}

async function deleteSearchSession(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const searchSessionId = this.getNodeParameter('searchSessionId', itemIndex) as string;

	await apiRequest.call(this, 'DELETE', `/workspaces/${workspaceName}/search_sessions/${searchSessionId}`);
	return { searchSessionId, success: true };
}

export async function executeSearchSession(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	let result: IDataObject | IDataObject[];
	switch (operation) {
		case 'create':
			result = await create.call(this, itemIndex);
			break;
		case 'getAll':
			result = await getAll.call(this, itemIndex);
			break;
		case 'delete':
			result = await deleteSearchSession.call(this, itemIndex);
			break;
		default:
			throw new NodeOperationError(this.getNode(), `Unknown Search Session operation: ${operation}`, { itemIndex });
	}

	const items = Array.isArray(result) ? result : [result];
	return items.map((json) => ({ json }));
}
