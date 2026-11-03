import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

export interface ContractTestCase {
	operation: string;
	description: string;
	/** Fed into `getNodeParameter` via `buildContractTestContext`. */
	params: Record<string, unknown>;
}

export interface ContractResourceSuite {
	resource: string;
	handler: (
		this: IExecuteFunctions,
		operation: string,
		itemIndex: number,
	) => Promise<INodeExecutionData[]>;
	cases: ContractTestCase[];
}
