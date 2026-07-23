import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_SPEC_URL = 'https://docs.cloud.deepset.ai/openapi.yaml';
const MOCK_PORT = 4577;
const READY_TIMEOUT_MS = 15_000;
const READY_POLL_INTERVAL_MS = 300;

let prismProcess: ChildProcess | undefined;

/**
 * Prism's bundled `@stoplight/json-schema-ref-parser` HTTP resolver is broken
 * against Node's native `fetch` on Node version 24 (worked on Node 22) — it
 * throws `RequestInit: Expected signal ... to be an instance of AbortSignal`
 * when `prism mock` is given a URL directly. So we fetch remote specs
 * ourselves with our own working `fetch()` and hand Prism a local file.
 */
async function resolveSpecToLocalFile(specSource: string): Promise<string> {
	if (!specSource.startsWith('http://') && !specSource.startsWith('https://')) {
		return specSource;
	}

	const response = await fetch(specSource);
	if (!response.ok) {
		throw new Error(`Failed to fetch spec from ${specSource}: ${response.status} ${response.statusText}`);
	}
	const body = await response.text();

	const dir = await mkdtemp(join(tmpdir(), 'contract-tests-spec-'));
	const filePath = join(dir, 'openapi.yaml');
	await writeFile(filePath, body, 'utf-8');
	return filePath;
}

/**
 * Prism is up as soon as it accepts a connection at all — a 404 for a path it
 * doesn't recognize still means the HTTP server is listening. `fetch` only
 * throws on connection failure (e.g. ECONNREFUSED before Prism has bound the
 * port), never on a non-2xx response, so any resolved call is "ready".
 */
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
	throw new Error(`Prism mock server did not become ready within ${READY_TIMEOUT_MS}ms: ${String(lastError)}`);
}

/**
 * `CONTRACT_TARGET=mock` (the default) starts a local Prism mock server from
 * `CONTRACT_SPEC` (default: the publicly published Haystack Enterprise spec)
 * and points the nodes at it. Any other `CONTRACT_TARGET` value is used
 * directly as the real base URL (e.g. an ephemeral environment) — no local
 * Prism started, so `CONTRACT_SPEC` should then point at a local spec file
 * matching that environment's actual code.
 */
export async function setup(): Promise<void> {
	const target = process.env.CONTRACT_TARGET ?? 'mock';

	if (target !== 'mock') {
		process.env.HAYSTACK_API_BASE_URL_OVERRIDE = target;
		return;
	}

	const specSource = process.env.CONTRACT_SPEC ?? DEFAULT_SPEC_URL;
	const spec = await resolveSpecToLocalFile(specSource);

	prismProcess = spawn('npx', ['--no-install', 'prism', 'mock', spec, '--port', String(MOCK_PORT), '--errors'], {
		stdio: 'pipe',
	});

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

	await new Promise<void>((resolve) => {
		prismProcess?.once('exit', () => resolve());
		prismProcess?.kill('SIGTERM');
		setTimeout(() => {
			prismProcess?.kill('SIGKILL');
			resolve();
		}, 3000);
	});
}
