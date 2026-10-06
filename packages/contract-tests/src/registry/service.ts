import type { ContractResourceSuite } from './types';

import { executeService } from '../../../haystack-enterprise/nodes/HaystackEnterprise/resources/service/Service.execute';
import { CONTRACT_TEST_UUID, cursorPaginationCases } from './caseFactories';

const CONTRACT_TEST_DEPLOYMENT_ID = CONTRACT_TEST_UUID;

/**
 * `/chat-stream` declares a bodiless 200 in the spec, so Prism answers with
 * an empty body: the node sees zero SSE events and returns an empty
 * aggregate. That still validates the request shape, which is what these
 * cases are for.
 */
export const serviceSuite: ContractResourceSuite = {
	resource: 'service',
	handler: executeService,
	cases: [
		{
			operation: 'get',
			description: 'GET /deployments/{deployment_id}',
			params: {
				workspaceName: 'contract-test-workspace',
				deploymentId: CONTRACT_TEST_DEPLOYMENT_ID,
			},
		},
		{
			// Every optional query param omitted — only limit + page_number are sent.
			operation: 'getAll',
			description: 'GET /deployments (no optional query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
			},
		},
		{
			// `field`/`order` have enum constraints in the spec, so a wrong value
			// here would fail against Prism.
			operation: 'getAll',
			description: 'GET /deployments (with filter + sort query params)',
			params: {
				workspaceName: 'contract-test-workspace',
				returnAll: false,
				limit: 5,
				filters: {
					groupLabel: 'PRODUCTION',
					odataFilter: "status eq 'DEPLOYED'",
				},
				sort: { field: 'name', order: 'ASC' },
			},
		},
		...cursorPaginationCases('/deployments'),
		{
			operation: 'listModels',
			description: 'GET /deployments/v1/models/',
			params: {
				workspaceName: 'contract-test-workspace',
			},
		},
		{
			// The example-workflow shape: one query, no session, no additional fields.
			operation: 'chat',
			description: 'POST /deployments/{deployment_id}/chat (query only)',
			params: {
				workspaceName: 'contract-test-workspace',
				deploymentId: CONTRACT_TEST_DEPLOYMENT_ID,
				query: 'hello from a contract test',
				searchSessionId: '',
			},
		},
		{
			operation: 'chat',
			description: 'POST /deployments/{deployment_id}/chat (session + every additional field)',
			params: {
				workspaceName: 'contract-test-workspace',
				deploymentId: CONTRACT_TEST_DEPLOYMENT_ID,
				query: 'hello from a contract test',
				searchSessionId: CONTRACT_TEST_UUID,
				additionalFields: {
					files: CONTRACT_TEST_UUID,
					filters: '{"field":"meta.category","operator":"==","value":"contract-test"}',
					params: '{"retriever":{"top_k":2}}',
					chatHistoryLimit: 5,
					chatHistoryGranularity: 'ALL_MESSAGES',
				},
			},
		},
		{
			operation: 'chatStream',
			description: 'POST /deployments/{deployment_id}/chat-stream (query only)',
			params: {
				workspaceName: 'contract-test-workspace',
				deploymentId: CONTRACT_TEST_DEPLOYMENT_ID,
				query: 'hello from a contract test',
				searchSessionId: '',
				simplify: true,
			},
		},
		{
			operation: 'chatStream',
			description:
				'POST /deployments/{deployment_id}/chat-stream (session + every additional field)',
			params: {
				workspaceName: 'contract-test-workspace',
				deploymentId: CONTRACT_TEST_DEPLOYMENT_ID,
				query: 'hello from a contract test',
				searchSessionId: CONTRACT_TEST_UUID,
				simplify: false,
				additionalFields: {
					files: CONTRACT_TEST_UUID,
					filters: '{"field":"meta.category","operator":"==","value":"contract-test"}',
					params: '{"retriever":{"top_k":2}}',
					chatHistoryLimit: 5,
					chatHistoryGranularity: 'QUERY_ANSWER',
					storeSearchHistory: false,
					includeResult: true,
					includeToolCalls: true,
					includeToolCallResults: true,
					includeReasoning: true,
				},
			},
		},
		{
			operation: 'chatCompletions',
			description: 'POST /deployments/v1/chat/completions (messages from fields)',
			params: {
				workspaceName: 'contract-test-workspace',
				deploymentId: CONTRACT_TEST_DEPLOYMENT_ID,
				messagesInput: 'fields',
				messages: {
					message: [
						{ role: 'system', content: 'You are a contract test.' },
						{ role: 'user', content: 'hello from a contract test' },
					],
				},
				stream: false,
				simplify: false,
			},
		},
		{
			operation: 'chatCompletions',
			description: 'POST /deployments/v1/chat/completions (messages as JSON + extra parameters)',
			params: {
				workspaceName: 'contract-test-workspace',
				deploymentId: CONTRACT_TEST_DEPLOYMENT_ID,
				messagesInput: 'json',
				messagesJson:
					'[{"role":"user","content":[{"type":"text","text":"hello from a contract test"}]}]',
				stream: false,
				simplify: false,
				additionalFields: {
					maxCompletionTokens: 64,
					topP: 0.9,
					extraParameters: '{"temperature":0.2}',
				},
			},
		},
	],
};
