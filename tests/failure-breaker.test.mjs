import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CODING_RUN_BUDGET_MS,
	CONSECUTIVE_FAILURE_TRIP_AFTER,
	createFailureBreaker,
	DEADLINE_NOTICE_THROTTLE_MS,
	DEADLINE_SAFETY_MS,
	DEADLINE_WARNING_MS,
	guardSandboxTool,
	IDENTICAL_FAILURE_TRIP_AFTER,
	IDENTICAL_FAILURE_WARN_AFTER,
	normalizeFailureSignature,
} from '../src/tools/failure-breaker.ts';

function makeBreaker({ now = () => 0, issueNumber = 423 } = {}) {
	const breaker = createFailureBreaker({ issueNumber, now });
	breaker.startRun(now() + CODING_RUN_BUDGET_MS);
	return breaker;
}

// Reproduces the incident's core loop: a sandbox whose every call fails
// identically (container unavailable) must stop being retryable long before
// the three-hour budget is spent.
test('identical tool failures warn, then trip the breaker with a publish instruction', () => {
	const breaker = makeBreaker();
	const error = () => new Error('Container is unavailable: no_container_instance_available');

	for (let i = 1; i < IDENTICAL_FAILURE_WARN_AFTER; i++) {
		const surfaced = breaker.noteFailure('bash', error());
		assert.equal(surfaced.message, error().message, `failure ${i} passes through unchanged`);
	}
	const warned = breaker.noteFailure('bash', error());
	assert.match(warned.message, /failed 3 times in a row/i);
	assert.match(warned.message, /Do not repeat it/);
	assert.match(warned.message, /comment_on_github_issue on issue #423/);

	let tripped;
	for (let i = IDENTICAL_FAILURE_WARN_AFTER; i < IDENTICAL_FAILURE_TRIP_AFTER; i++) {
		tripped = breaker.noteFailure('bash', error());
	}
	assert.match(tripped.message, /Sandbox tools are disabled/);
	assert.match(tripped.message, /comment_on_github_issue on issue #423/);
	assert.equal(breaker.status().tripped, true);

	// Once tripped, every sandbox tool fails fast — before touching the sandbox.
	assert.throws(() => breaker.guardToolCall('read'), /Sandbox tools are disabled/);
	assert.throws(() => breaker.guardToolCall('glob'), /publish what you know/i);
});

test('mixed consecutive failures trip the breaker at the aggregate threshold', () => {
	const breaker = makeBreaker();
	let last;
	for (let i = 0; i < CONSECUTIVE_FAILURE_TRIP_AFTER; i++) {
		last = breaker.noteFailure(i % 2 === 0 ? 'bash' : 'read', new Error(`distinct failure ${i} ${Math.random()}`));
	}
	assert.equal(breaker.status().tripped, true);
	assert.match(last.message, /consecutive sandbox tool failures/);
});

test('a success resets the failure counters', () => {
	const breaker = makeBreaker();
	for (let i = 0; i < IDENTICAL_FAILURE_TRIP_AFTER - 1; i++) {
		breaker.noteFailure('bash', new Error('same failure'));
	}
	breaker.recordSuccess();
	const surfaced = breaker.noteFailure('bash', new Error('same failure'));
	assert.equal(surfaced.message, 'same failure', 'counter restarted after a success');
	assert.equal(breaker.status().tripped, false);
});

test('aborts do not count as failures', () => {
	const breaker = makeBreaker();
	const abort = new DOMException('The operation was aborted.', 'AbortError');
	for (let i = 0; i < CONSECUTIVE_FAILURE_TRIP_AFTER + 2; i++) {
		assert.equal(breaker.noteFailure('bash', abort), abort);
	}
	assert.equal(breaker.status().tripped, false);
	assert.equal(breaker.status().consecutiveFailures, 0);
});

test('a new submission resets a tripped breaker (label retry starts clean)', () => {
	const breaker = makeBreaker();
	for (let i = 0; i < IDENTICAL_FAILURE_TRIP_AFTER; i++) {
		breaker.noteFailure('bash', new Error('broken'));
	}
	assert.equal(breaker.status().tripped, true);
	breaker.startRun(CODING_RUN_BUDGET_MS);
	assert.equal(breaker.status().tripped, false);
	assert.doesNotThrow(() => breaker.guardToolCall('bash'));
});

test('volatile error details (ids, counts) still count as identical failures', () => {
	const a = normalizeFailureSignature('bash', 'RPC failed after 3 retries (request id deadbeef01)');
	const b = normalizeFailureSignature('bash', 'RPC failed after 7 retries (request id cafebabe99)');
	assert.equal(a, b);
	assert.notEqual(a, normalizeFailureSignature('read', 'RPC failed after 3 retries (request id deadbeef01)'));
});

test('deadline notices begin near the budget end, escalate inside the safety window, and are throttled', () => {
	let at = 0;
	const breaker = createFailureBreaker({ issueNumber: 423, now: () => at });
	breaker.startRun(CODING_RUN_BUDGET_MS);

	assert.equal(breaker.deadlineNotice(), undefined, 'no notice at the start of the run');

	at = CODING_RUN_BUDGET_MS - DEADLINE_WARNING_MS + 1;
	const first = breaker.deadlineNotice();
	assert.match(first, /\[harness\] Deadline approaching/);
	assert.match(first, /commit your work and push the branch/);
	assert.match(first, /issue #423/);

	assert.equal(breaker.deadlineNotice(), undefined, 'immediately repeated notice is throttled');
	at += DEADLINE_NOTICE_THROTTLE_MS + 1;
	assert.match(breaker.deadlineNotice(), /Deadline approaching/);

	at = CODING_RUN_BUDGET_MS - DEADLINE_SAFETY_MS + 1;
	const urgent = breaker.deadlineNotice();
	assert.match(urgent, /DEADLINE/);
	assert.match(urgent, /about to be aborted/);
	assert.match(urgent, /Publish immediately/);
});

// The guard wrapper: the exact seam that replaces the framework's naked
// sandbox tools for coding runs.
test('guardSandboxTool counts failures, fails fast after the trip, and appends deadline notices', async () => {
	let at = 0;
	const breaker = createFailureBreaker({ issueNumber: 423, now: () => at });
	breaker.startRun(CODING_RUN_BUDGET_MS);

	let calls = 0;
	const failing = guardSandboxTool(
		{
			name: 'bash',
			async execute() {
				calls += 1;
				throw new Error('Container is unavailable');
			},
		},
		breaker,
	);

	for (let i = 0; i < IDENTICAL_FAILURE_TRIP_AFTER; i++) {
		await assert.rejects(failing.execute('id', {}));
	}
	assert.equal(calls, IDENTICAL_FAILURE_TRIP_AFTER);
	// Tripped: the underlying tool is no longer invoked at all.
	await assert.rejects(failing.execute('id', {}), /Sandbox tools are disabled/);
	assert.equal(calls, IDENTICAL_FAILURE_TRIP_AFTER, 'no further sandbox calls after the trip');

	breaker.startRun(CODING_RUN_BUDGET_MS);
	const succeeding = guardSandboxTool(
		{
			name: 'read',
			async execute() {
				return { content: [{ type: 'text', text: 'file body' }], details: {} };
			},
		},
		breaker,
	);
	at = CODING_RUN_BUDGET_MS - DEADLINE_SAFETY_MS + 1;
	const result = await succeeding.execute('id', {});
	assert.equal(result.content.length, 2, 'deadline notice appended to the result');
	assert.match(result.content[1].text, /DEADLINE/);
	assert.equal(result.content[0].text, 'file body', 'original content preserved');
});
