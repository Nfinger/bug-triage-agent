import assert from 'node:assert/strict';
import test from 'node:test';

import { checkpointWorkBranch } from '../src/tools/checkpoint.ts';

// Scripted sandbox exec: matches commands by substring, records the sequence.
function scriptedExec(script) {
	const calls = [];
	const exec = async (command) => {
		calls.push(command);
		for (const [needle, result] of script) {
			if (command.includes(needle)) {
				return { exitCode: 0, stdout: '', stderr: '', ...result };
			}
		}
		return { exitCode: 0, stdout: '', stderr: '' };
	};
	return { exec, calls };
}

test('a dirty tree with commits is committed and pushed', async () => {
	const { exec, calls } = scriptedExec([
		['status --porcelain', { stdout: ' M src/app.ts\n' }],
		['symbolic-ref', { stdout: 'origin/main\n' }],
		['rev-list --count', { stdout: '2\n' }],
	]);
	const outcome = await checkpointWorkBranch(exec, 'agent/issue-423');
	assert.deepEqual(
		{ attempted: true, committed: true, pushed: true, branch: 'agent/issue-423' },
		{ attempted: outcome.attempted, committed: outcome.committed, pushed: outcome.pushed, branch: outcome.branch },
	);
	assert.match(outcome.detail, /2 commit\(s\) preserved on agent\/issue-423/);
	assert.ok(calls.some((c) => c.includes('git -C /workspace/repo add -A')));
	assert.ok(calls.some((c) => c.includes('push -u origin agent/issue-423')));
});

test('a clean tree with no commits beyond the default branch pushes nothing', async () => {
	const { exec, calls } = scriptedExec([
		['status --porcelain', { stdout: '' }],
		['symbolic-ref', { stdout: 'origin/main\n' }],
		['rev-list --count', { stdout: '0\n' }],
	]);
	const outcome = await checkpointWorkBranch(exec, 'agent/issue-9');
	assert.equal(outcome.attempted, true);
	assert.equal(outcome.committed, false);
	assert.equal(outcome.pushed, false);
	assert.match(outcome.detail, /no local work to preserve/);
	assert.ok(!calls.some((c) => c.includes('push')), 'no empty remote branch is created');
});

test('a run that never set up its workspace reports that instead of failing', async () => {
	const { exec } = scriptedExec([['test -d /workspace/repo/.git', { exitCode: 1 }]]);
	const outcome = await checkpointWorkBranch(exec, 'agent/issue-1');
	assert.equal(outcome.attempted, false);
	assert.match(outcome.detail, /no workspace clone/);
});

// The incident's environment: a dead container makes every command fail.
// The checkpoint must degrade to an honest report, never throw or hang the
// failsafe that runs it.
test('a dead sandbox yields a failed-but-described checkpoint, not a throw', async () => {
	const exec = async () => {
		throw new Error('checkpoint command exceeded its 45000ms deadline');
	};
	const outcome = await checkpointWorkBranch(exec, 'agent/issue-423');
	assert.equal(outcome.pushed, false);
	assert.match(outcome.detail, /checkpoint error: .*deadline/);
});

test('a failing push is reported in the outcome detail', async () => {
	const { exec } = scriptedExec([
		['status --porcelain', { stdout: 'M x\n' }],
		['symbolic-ref', { stdout: 'origin/main\n' }],
		['rev-list --count', { stdout: '1\n' }],
		['push -u origin', { exitCode: 128, stderr: 'fatal: could not read Username' }],
	]);
	const outcome = await checkpointWorkBranch(exec, 'agent/issue-2');
	assert.equal(outcome.committed, true);
	assert.equal(outcome.pushed, false);
	assert.match(outcome.detail, /push failed: fatal: could not read Username/);
});
