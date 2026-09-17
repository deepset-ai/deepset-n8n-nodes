import { fileSuite } from './file';
import { indexSuite } from './indexResource';
import { searchSessionSuite } from './searchSession';
import { serviceSuite } from './service';
import type { ContractResourceSuite } from './types';

export const contractResourceSuites: ContractResourceSuite[] = [
	serviceSuite,
	indexSuite,
	fileSuite,
	searchSessionSuite,
];

export type { ContractResourceSuite, ContractTestCase } from './types';
