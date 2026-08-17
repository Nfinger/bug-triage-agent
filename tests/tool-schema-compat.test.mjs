import assert from 'node:assert/strict';
import test from 'node:test';

import { validateToolArguments } from '@earendil-works/pi-ai';
import {
	createBashTool,
	createEditTool,
	createGlobTool,
	createGrepTool,
	createReadTool,
	createWriteTool,
} from '@flue/runtime';

// Investigation question from the 2026-08-16 incident: are the sandbox
// command/tool schemas incompatible with the configured model
// (openrouter/moonshotai/kimi-k2.6)? Answer: no — and this test pins why.
// The tools are serialized to the provider as plain JSON Schema (the
// OpenAI-completions payload sends `parameters` as-is, strict mode off), and
// inbound arguments are coerced (TypeBox Value.Convert) before validation,
// so the lax shapes chat models actually emit — numeric fields as strings,
// harmless extra keys — validate fine. Tool errors observed in the incident
// came from the sandbox environment, not from schema rejection.

const stubEnv = {
	exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
	readFile: async () => '',
	readFileBuffer: async () => new Uint8Array(),
	writeFile: async () => {},
	stat: async () => ({ isFile: true, isDirectory: false, isSymbolicLink: false, size: 0, mtime: new Date(0) }),
	readdir: async () => [],
	exists: async () => true,
	mkdir: async () => {},
	rm: async () => {},
	cwd: '/workspace',
	resolvePath: (p) => p,
};

const tools = [
	createReadTool(stubEnv),
	createWriteTool(stubEnv),
	createEditTool(stubEnv),
	createBashTool(stubEnv),
	createGrepTool(stubEnv),
	createGlobTool(stubEnv),
];

test('every sandbox tool schema serializes to plain, provider-safe JSON Schema', () => {
	for (const tool of tools) {
		const wire = JSON.parse(JSON.stringify(tool.parameters));
		assert.equal(wire.type, 'object', `${tool.name}: top-level object schema`);
		assert.ok(wire.properties && Object.keys(wire.properties).length > 0, `${tool.name}: has properties`);
		for (const [key, prop] of Object.entries(wire.properties)) {
			assert.ok(
				typeof prop.type === 'string',
				`${tool.name}.${key}: plain typed property (no unsupported composition)`,
			);
			assert.ok(
				['string', 'number', 'boolean'].includes(prop.type),
				`${tool.name}.${key}: primitive parameter type, universally supported`,
			);
		}
		// No TypeBox symbols or undefined values survive serialization.
		assert.doesNotMatch(JSON.stringify(wire), /undefined/);
	}
});

test('model-lax arguments (stringly numbers, extra keys) validate through coercion', () => {
	const bash = tools.find((tool) => tool.name === 'bash');
	const coerced = validateToolArguments(bash, {
		name: 'bash',
		arguments: { command: 'pnpm install', timeout: '120' },
	});
	assert.equal(coerced.timeout, 120, 'string timeout coerced to number');

	const read = tools.find((tool) => tool.name === 'read');
	const readArgs = validateToolArguments(read, {
		name: 'read',
		arguments: { path: '/workspace/repo/package.json', offset: '2', limit: '10', reasoning: 'peek' },
	});
	assert.equal(readArgs.offset, 2);
	assert.equal(readArgs.limit, 10);

	const glob = tools.find((tool) => tool.name === 'glob');
	assert.doesNotThrow(() =>
		validateToolArguments(glob, { name: 'glob', arguments: { pattern: '*.ts', path: 'src' } }),
	);
});

test('genuinely malformed arguments still fail validation (the check is real)', () => {
	const bash = tools.find((tool) => tool.name === 'bash');
	assert.throws(
		() => validateToolArguments(bash, { name: 'bash', arguments: {} }),
		/Validation failed for tool "bash"/,
	);
});
