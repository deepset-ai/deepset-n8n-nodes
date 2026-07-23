import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.contract.test.ts'],
		globalSetup: ['./src/globalSetup.ts'],
		setupFiles: ['./src/setup.ts'],
		testTimeout: 20_000,
		hookTimeout: 20_000,
	},
});
