import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_SPEC_URL = 'https://docs.cloud.deepset.ai/openapi.yaml';
const MOCK_PORT = 4577;
const READY_TIMEOUT_MS = 15_000;
const READY_POLL_INTERVAL_MS = 300;

let prismProcess: ChildProcess | undefined;

/** Fetches remote specs to a local file; Prism's own URL resolver fails on Node 24. */
async function resolveSpecToLocalFile(specSource: string): Promise<string> {
	if (!specSource.startsWith('http://') && !specSource.startsWith('https://')) {
		return specSource;
	}

	const response = await fetch(specSource);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch spec from ${specSource}: ${response.status} ${response.statusText}`,
		);
	}
	const body = await response.text();

	const dir = await mkdtemp(join(tmpdir(), 'contract-tests-spec-'));
	const filePath = join(dir, 'openapi.yaml');
	await writeFile(filePath, body, 'utf-8');
	return filePath;
}

/** Ready once Prism accepts a connection; any HTTP response counts. */
async function waitForPrismReady(port: number, proc: ChildProcess): Promise<void> {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			await fetch(`http://127.0.0.1:${port}/`);
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
		}
	}

	proc.kill();
	throw new Error(
		`Prism mock server did not become ready within ${READY_TIMEOUT_MS}ms: ${String(lastError)}`,
	);
}

/**
 * `CONTRACT_TARGET=mock` (default) starts a local Prism mock from `CONTRACT_SPEC`.
 * Any other value is used directly as the base URL and no mock is started.
 */
export async function setup(): Promise<void> {
	const target = process.env.CONTRACT_TARGET ?? 'mock';

	if (target !== 'mock') {
		process.env.HAYSTACK_API_BASE_URL_OVERRIDE = target;
		return;
	}

	const specSource = process.env.CONTRACT_SPEC ?? DEFAULT_SPEC_URL;
	const spec = await resolveSpecToLocalFile(specSource);

	prismProcess = spawn(
		'npx',
		['--no-install', 'prism', 'mock', spec, '--port', String(MOCK_PORT), '--errors'],
		{
			stdio: 'pipe',
		},
	);

	let stderr = '';
	prismProcess.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	prismProcess.on('exit', (code) => {
		if (code !== null && code !== 0) {
			// eslint-disable-next-line no-console -- surfacing Prism's own failure output is the point here
			console.error(`Prism exited with code ${code}\n${stderr}`);
		}
	});

	await waitForPrismReady(MOCK_PORT, prismProcess);
	process.env.HAYSTACK_API_BASE_URL_OVERRIDE = `http://127.0.0.1:${MOCK_PORT}/api/v1`;
}

export async function teardown(): Promise<void> {
	if (!prismProcess) return;
	const proc = prismProcess;

	await new Promise<void>((resolve) => {
		const forceKillTimer = setTimeout(() => {
			proc.kill('SIGKILL');
		}, 3000);

		proc.once('exit', () => {
			clearTimeout(forceKillTimer);
			resolve();
		});

		proc.kill('SIGTERM');
	});
}
