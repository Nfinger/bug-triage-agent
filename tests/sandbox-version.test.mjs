import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const codingAgent = await readFile(new URL('../src/agents/coding.ts', import.meta.url), 'utf8');
const codingWorkers = await readFile(new URL('../src/agents/coding-workers.ts', import.meta.url), 'utf8');
const githubPrTools = await readFile(new URL('../src/tools/github-pr.ts', import.meta.url), 'utf8');

test('Sandbox SDK and container base image use the same exact version', () => {
	const sdkVersion = packageJson.dependencies['@cloudflare/sandbox'];
	assert.match(sdkVersion, /^\d+\.\d+\.\d+$/, 'Sandbox SDK must be pinned to an exact version');

	const baseImage = dockerfile.match(/^FROM docker\.io\/cloudflare\/sandbox:(\S+)$/m);
	assert.ok(baseImage, 'Dockerfile must use the versioned Cloudflare Sandbox base image');
	assert.equal(baseImage[1], sdkVersion);
});

test('issue sandbox lifetime matches the coding agent durability budget', () => {
	const durability = codingAgent.match(/Coding\.durability\s*=\s*\{\s*timeoutMs:\s*([\d_]+)/);
	const sleepAfter = codingWorkers.match(/sleepAfter:\s*'(\d+)h'/);
	assert.ok(durability, 'Coding agent must declare a durability timeout');
	assert.ok(sleepAfter, 'Issue sandbox must declare an hour-based sleep timeout');

	const durabilityMs = Number(durability[1].replaceAll('_', ''));
	const sandboxSleepMs = Number(sleepAfter[1]) * 60 * 60 * 1000;
	assert.equal(sandboxSleepMs, durabilityMs);
});

test('optional dependency install has an independent caller deadline', () => {
	assert.match(
		githubPrTools,
		/await withDeadline\(\s*harness\.sandbox\.exec\([\s\S]*?execOptions\(180_000\)[\s\S]*?195_000,[\s\S]*?catch \(error\) \{[\s\S]*?install = `failed:/,
	);
});
