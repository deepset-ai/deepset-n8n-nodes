/**
 * n8n-core is a peer dependency (see package.json) resolved at runtime against
 * n8n's own installed copy — never bundled — so that our tools are recognized
 * as a genuine n8n-core StructuredToolkit by n8n's own instanceof checks
 * (getConnectedTools, ToolExecutor, extendResponseMetadata). It isn't
 * installed locally (its transitive dependency tree is enormous and
 * irrelevant to this package), so this ambient declaration covers the one
 * export we need for local typechecking.
 */
declare module 'n8n-core' {
	import type { StructuredToolInterface } from '@langchain/core/tools';

	export class StructuredToolkit<T extends StructuredToolInterface = StructuredToolInterface> {
		constructor(tools: T[]);
		tools: T[];
		getTools(): T[];
	}
}
