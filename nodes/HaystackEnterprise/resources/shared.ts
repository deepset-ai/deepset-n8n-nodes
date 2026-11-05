import type { INodeProperties } from 'n8n-workflow';

/** Extra Parameters (JSON). `sentAs` chooses the query-string or body hint. */
export function extraParametersOption(sentAs: 'body' | 'query'): INodeProperties {
	return {
		displayName: 'Extra Parameters (JSON)',
		name: 'extraParameters',
		type: 'json',
		default: '{}',
		description:
			sentAs === 'query'
				? 'Other API fields forwarded as-is as query parameters. Merged over the query fields above.'
				: 'Other API fields forwarded as-is on the request body.',
	};
}
