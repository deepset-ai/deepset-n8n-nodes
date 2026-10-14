// Minimal ambient declaration: n8n-core is a peer dependency not installed locally.
declare module 'n8n-core' {
	import type { StructuredToolInterface } from '@langchain/core/tools';

	export class StructuredToolkit<T extends StructuredToolInterface = StructuredToolInterface> {
		constructor(tools: T[]);
		tools: T[];
		getTools(): T[];
	}
}
