import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { CodeWriter, Investigator } from '../src/agents/coding-workers.ts';

const workersSource = await readFile(
	new URL('../src/agents/coding-workers.ts', import.meta.url),
	'utf8',
);
const codingSource = await readFile(new URL('../src/agents/coding.ts', import.meta.url), 'utf8');
const sandboxSource = await readFile(
	new URL('../src/agents/coding-sandbox.ts', import.meta.url),
	'utf8',
);

// ROOT-CAUSE REGRESSION (2026-08-16): the worker subagents attached the
// per-issue sandbox inside their own renders. Flue forbids useSandbox() in a
// subagent render — delegates inherit the parent's environment — so every
// investigator/code-writer delegation threw immediately, and the
// orchestrator (told never to edit code itself) could not produce a single
// PR in 10/10 runs. Flue hooks throw when called outside an agent render, so
// the strongest guard is behavioral: the worker agent functions must render
// as plain functions, with no hook calls at all.
test('worker subagents render outside the framework: no hooks, no sandbox attachment', () => {
	let investigatorPrompt;
	let codeWriterPrompt;
	assert.doesNotThrow(() => {
		investigatorPrompt = Investigator();
	});
	assert.doesNotThrow(() => {
		codeWriterPrompt = CodeWriter();
	});
	assert.equal(typeof investigatorPrompt, 'string');
	assert.equal(typeof codeWriterPrompt, 'string');
	assert.ok(investigatorPrompt.includes('/workspace/repo'), 'investigator works the shared checkout');
	assert.ok(codeWriterPrompt.includes('/workspace/repo'), 'code-writer works the shared checkout');
});

test('coding-workers has no sandbox machinery at all', () => {
	// The module must be import-free: no framework hooks, no Cloudflare
	// bindings — nothing a subagent render could illegally invoke. (Comments
	// may mention the forbidden APIs; imports and calls may not.)
	assert.doesNotMatch(workersSource, /^import /m);
	assert.doesNotMatch(workersSource, /useSandbox\s*\(/);
	assert.doesNotMatch(workersSource, /getSandbox\s*\(/);
	assert.doesNotMatch(workersSource, /attachIssueSandbox\s*\(/);
});

test('only the orchestrator attaches the per-issue sandbox, with breaker-guarded tools', () => {
	// The orchestrator attaches exactly once, in its own render.
	assert.match(codingSource, /attachIssueSandbox\(issue, \{ deadlineAt: runDeadlineAt \}\)/);
	// The attachment routes the model's sandbox tools through the failure breaker.
	assert.match(sandboxSource, /tools: guardedSandboxTools\(breaker\)/);
	assert.match(sandboxSource, /guardSandboxTool\(tool, breaker\)/);
	// And the six standard tools stay the composed set.
	for (const factory of [
		'createReadTool',
		'createWriteTool',
		'createEditTool',
		'createBashTool',
		'createGrepTool',
		'createGlobTool',
	]) {
		assert.ok(sandboxSource.includes(`${factory}(sandbox)`), `${factory} composed into the guarded set`);
	}
});

test('worker briefs bound their own retries', () => {
	assert.match(Investigator(), /fails the same way more than twice in a row, stop retrying/);
	assert.match(CodeWriter(), /fails the same way more than twice in a row, stop retrying/);
});

test('the orchestrator wires the run-governance hooks', () => {
	// Deadline recorded per submission, breaker reset with it.
	assert.match(codingSource, /useAgentStart\(\(\) => \{/);
	assert.match(codingSource, /breaker\.startRun\(deadline\)/);
	// Fail-closed publication enforcement at the finish seam.
	assert.match(codingSource, /useAgentFinish\(async \(ctx\) => \{/);
	assert.match(codingSource, /publicationOutcome\(ctx\.response\.toolCalls\)/);
	assert.match(codingSource, /enforcementSignal\(issue, enforcements \+ 1\)/);
	assert.match(codingSource, /postBlockerCommentOnce\(/);
	// The prompt tells the model about the limits the harness enforces.
	assert.match(codingSource, /Operating limits — the harness enforces these:/);
	assert.match(codingSource, /\[harness\] Deadline/);
	assert.match(codingSource, /Sandbox tools are disabled/);
});
