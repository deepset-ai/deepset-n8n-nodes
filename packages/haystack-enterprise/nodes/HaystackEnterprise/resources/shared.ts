import type { INodeProperties } from 'n8n-workflow';

export const DOCS_BASE_URL = 'https://docs.cloud.deepset.ai/docs/api/main';

/**
 * Builds an `apiDocsNotice(operation, urlSlug)` helper bound to a specific
 * resource — a "See the API docs for this endpoint" notice property, shown
 * only when that resource+operation combination is selected. Shared by the
 * File/Index/Search Session resources' description files.
 */
export function createApiDocsNotice(resource: string) {
	return (operation: string, urlSlug: string): INodeProperties => ({
		displayName: `See the <a href="${DOCS_BASE_URL}/${urlSlug}" target="_blank">Haystack Enterprise API docs</a> for this endpoint`,
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
