#!/usr/bin/env node
// Runs the n8n Cloud community-node scanner (@n8n/scan-community-package) against a local build.
// `n8n-node lint` is broader/stricter than what Cloud verifies, so this is the more reliable pre-release gate.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzePackage } from '@n8n/scan-community-package/scanner/scanner.mjs';

const tmpDir = mkdtempSync(join(tmpdir(), 'n8n-cloud-scan-'));

try {
	console.log('Building...');
	execFileSync('npx', ['n8n-node', 'build'], { stdio: 'inherit' });

	console.log('Packing...');
	execFileSync('npm', ['pack', '--silent', '--pack-destination', tmpDir], { stdio: 'inherit' });

	const tarball = readdirSync(tmpDir).find((file) => file.endsWith('.tgz'));
	if (!tarball) throw new Error('npm pack did not produce a tarball');

	execFileSync('tar', ['-xzf', tarball, '-C', tmpDir], { cwd: tmpDir, stdio: 'inherit' });
	const packageDir = join(tmpDir, 'package');

	console.log('Scanning...');
	const result = await analyzePackage(packageDir);

	if (result.passed) {
		console.log('✅ Package passed all n8n Cloud community-node checks');
	} else {
		console.error('❌ Package failed n8n Cloud community-node checks');
		console.error(`Reason: ${result.message}`);
		if (result.details) console.error(result.details);
		process.exitCode = 1;
	}
} finally {
	rmSync(tmpDir, { recursive: true, force: true });
}
