import type { INodeProperties } from 'n8n-workflow';

export const DOCS_BASE_URL = 'https://docs.cloud.deepset.ai/docs/api/main';

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

export function extraParametersField(
	resource: string,
	operation: string,
	sentAs: 'body' | 'query',
): INodeProperties {
	return {
		...extraParametersOption(sentAs),
		displayOptions: {
			show: {
				resource: [resource],
				operation: [operation],
			},
		},
	};
}

/**
 * Builds an `apiDocsNotice(operation, urlSlug)` helper bound to a specific
 * resource — a "See the API docs for this endpoint" notice property, shown
 * only when that resource+operation combination is selected. Shared by the
 * File/Index/Search Session resources' description files.
 */
export function createApiDocsNotice(resource: string) {
	return (operation: string, urlSlug: string): INodeProperties => ({
		displayName: `See the <a href="${DOCS_BASE_URL}/${urlSlug}" target="_blank" rel="noopener noreferrer">Haystack Enterprise API docs</a> for this endpoint`,
		name: `apiDocsNotice_${operation}`,
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				resource: [resource],
				operation: [operation],
			},
		},
	});
}
