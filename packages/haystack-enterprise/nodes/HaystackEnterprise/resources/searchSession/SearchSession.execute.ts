import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	apiRequest,
	createSearchSession,
	extractSearchSessionList,
	fetchDeployment,
	fetchPaginatedResults,
	getSourcePipelineId,
} from '../../utils';

async function create(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const deploymentId = this.getNodeParameter('deploymentId', itemIndex) as string;

	const deployment = await fetchDeployment.call(this, workspaceName, deploymentId);
	const pipelineId = getSourcePipelineId(deployment);
	if (!pipelineId) {
		throw new NodeOperationError(
			this.getNode(),
			'This service has no active revision, so its underlying pipeline could not be determined.',
			{ itemIndex },
		);
	}

	const searchSessionId = await createSearchSession.call(this, workspaceName, pipelineId);
	return { search_session_id: searchSessionId };
}

async function getAll(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const workspaceName = this.getNodeParameter('workspaceName', itemIndex) as string;
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;

	const qs: IDataObject = {};
	if (filters.odataFilter) {
		qs.filter = filters.odataFilter;
	}

	const endpoint = `/workspaces/${workspaceName}/search_sessions`;
	const limit = returnAll ? 100 : (this.getNodeParameter('limit', itemIndex) as number);

	if (!returnAll && (filters.before || filters.after)) {
		// `before`/`after` are mutually exclusive with `page_number` per the API
		// docs ("To use this option, clear the page_number parameter first") —
		// bypass fetchPaginatedResults() (which always sends page_number) and
		// query directly instead.
		if (filters.before) qs.before = filters.before;
		if (filters.after) qs.after = filters.after;
		const response = await apiRequest.call(this, 'GET', endpoint, { qs: { ...qs, limit } });
		return extractSearchSessionList(response);
	}

	return fetchPaginatedResults(this, endpoint, qs, returnAll, limit, extractSearchSessionList);
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
			throw new Error(`Unknown Search Session operation: ${operation}`);
	}

	const items = Array.isArray(result) ? result : [result];
	return items.map((json) => ({ json }));
}
