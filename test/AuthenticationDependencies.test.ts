import { describe, expect, it } from 'vitest';

import { HaystackEnterpriseAi } from '../nodes/HaystackEnterprise/HaystackEnterpriseAi.node';
import { HaystackEnterpriseChatModel } from '../nodes/HaystackEnterpriseChatModel/HaystackEnterpriseChatModel.node';

function collectLoadOptionsProperties(value: unknown): Array<Record<string, unknown>> {
	if (!value || typeof value !== 'object') return [];
	if (Array.isArray(value)) return value.flatMap(collectLoadOptionsProperties);

	const record = value as Record<string, unknown>;
	const typeOptions = record.typeOptions as Record<string, unknown> | undefined;
	const current = typeOptions?.loadOptionsMethod ? [record] : [];
	return [...current, ...Object.values(record).flatMap(collectLoadOptionsProperties)];
}

describe('authentication-dependent options', () => {
	const nodes = [
		['Haystack Enterprise AI', new HaystackEnterpriseAi()],
		['Haystack Enterprise Chat Model', new HaystackEnterpriseChatModel()],
	] as const;

	it.each(nodes)('keeps authentication node-wide on %s', (_name, node) => {
		const authentication = node.description.properties.find(
			(property) => property.name === 'authentication',
		);

		expect(authentication?.noDataExpression).toBe(true);
	});

	it.each(nodes)(
		'reloads every API-backed option when authentication changes on %s',
		(_name, node) => {
			const loadOptionsProperties = collectLoadOptionsProperties(node.description.properties);

			expect(loadOptionsProperties.length).toBeGreaterThan(0);
			for (const property of loadOptionsProperties) {
				const typeOptions = property.typeOptions as { loadOptionsDependsOn?: string[] };
				expect(typeOptions.loadOptionsDependsOn).toContain('authentication');
			}
		},
	);
});
