import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildBlockerComment,
	enforcementSignal,
	failsafeMarker,
	handleCodingSettlement,
	MAX_PUBLICATION_ENFORCEMENTS,
	nextEnforcementAction,
	postBlockerCommentOnce,
	publicationOutcome,
} from '../src/tools/publication-failsafe.ts';

const ref = { owner: 'Stock-GPT', repo: 'marketsavvy', issueNumber: 423 };

test('publicationOutcome counts only successful publish calls', () => {
	assert.deepEqual(publicationOutcome([]), { prOpened: false, commented: false, published: false });
	assert.deepEqual(
		publicationOutcome([
			{ tool: 'bash', isError: true },
			{ tool: 'comment_on_github_issue', isError: true },
		]),
		{ prOpened: false, commented: false, published: false },
	);
	assert.equal(publicationOutcome([{ tool: 'comment_on_github_issue', isError: false }]).published, true);
	assert.equal(publicationOutcome([{ tool: 'open_pull_request', isError: false }]).published, true);
});

// Reproduces the incident's "0 PRs, 0 blocker reports" shape at the finish
// seam: an unpublished response is redirected a bounded number of times and
// then the harness comments itself — it can never simply settle silent.
test('an unpublished response is redirected, then commented on directly — never settled silent', () => {
	const unpublished = publicationOutcome([{ tool: 'bash', isError: true }]);
	for (let prior = 0; prior < MAX_PUBLICATION_ENFORCEMENTS; prior++) {
		assert.equal(nextEnforcementAction(unpublished, prior), 'redirect');
	}
	assert.equal(nextEnforcementAction(unpublished, MAX_PUBLICATION_ENFORCEMENTS), 'comment-directly');
	assert.equal(nextEnforcementAction(unpublished, MAX_PUBLICATION_ENFORCEMENTS + 5), 'comment-directly');

	const published = publicationOutcome([{ tool: 'open_pull_request', isError: false }]);
	assert.equal(nextEnforcementAction(published, 0), 'settle');
	assert.equal(nextEnforcementAction(published, MAX_PUBLICATION_ENFORCEMENTS), 'settle');
});

test('the enforcement signal names the issue and both publish tools', () => {
	const signal = enforcementSignal(ref, 1);
	assert.equal(signal.kind, 'signal');
	assert.equal(signal.type, 'publication.enforcement');
	assert.match(signal.body, /#423/);
	assert.match(signal.body, /open_pull_request/);
	assert.match(signal.body, /comment_on_github_issue/);
});

test('the blocker comment reports breaker and checkpoint context', () => {
	const body = buildBlockerComment({
		ref,
		reason: 'run-failed',
		branch: 'agent/issue-423',
		errorType: 'SubmissionTimeoutError',
		breaker: {
			tripped: true,
			tripReason: '5 consecutive identical bash failures ("Container is unavailable")',
			consecutiveFailures: 5,
		},
		checkpoint: {
			attempted: true,
			committed: true,
			pushed: true,
			branch: 'agent/issue-423',
			detail: '2 commit(s) preserved on agent/issue-423',
		},
	});
	assert.match(body, /settled as failed: `SubmissionTimeoutError`/);
	assert.match(body, /Sandbox tools were disabled after repeated failures/);
	assert.match(body, /Container is unavailable/);
	assert.match(body, /branch `agent\/issue-423`/);
	assert.match(body, /NOT passed validation/);
	assert.match(body, /remove and re-apply the coding-agent label/);
});

test('postBlockerCommentOnce dedupes on the embedded marker', async () => {
	const posted = [];
	const client = {
		listComments: async () => posted.map((body) => ({ body })),
		createComment: async (_ref, body) => void posted.push(body),
	};
	const first = await postBlockerCommentOnce(client, ref, 'settled:sub-1', 'blocked');
	assert.deepEqual(first, { posted: true, deduped: false });
	const second = await postBlockerCommentOnce(client, ref, 'settled:sub-1', 'blocked again');
	assert.deepEqual(second, { posted: false, deduped: true });
	assert.equal(posted.length, 1);
	assert.ok(posted[0].includes(failsafeMarker('settled:sub-1')));

	// A different submission is a different failure and posts again.
	await postBlockerCommentOnce(client, ref, 'settled:sub-2', 'new failure');
	assert.equal(posted.length, 2);
});

test('a listing failure fails open: the comment is still posted', async () => {
	const posted = [];
	const client = {
		listComments: async () => {
			throw new Error('rate limited');
		},
		createComment: async (_ref, body) => void posted.push(body),
	};
	const result = await postBlockerCommentOnce(client, ref, 'k', 'body');
	assert.deepEqual(result, { posted: true, deduped: false });
	assert.equal(posted.length, 1);
});

function settlementDeps(overrides = {}) {
	const record = {
		checkpoints: [],
		comments: [],
		logs: [],
	};
	const deps = {
		codingAgentName: 'Coding',
		parseInstanceId: (id) => {
			const match = /^github:v1:owner:([^:]+):repo:([^:]+):issue:(\d+)$/.exec(id);
			if (!match) throw new Error('invalid id');
			return { owner: match[1], repo: match[2], issueNumber: Number(match[3]) };
		},
		workBranch: (issueNumber) => `agent/issue-${issueNumber}`,
		breakerStatus: () => ({ tripped: false, consecutiveFailures: 0 }),
		checkpoint: async (issueRef) => {
			record.checkpoints.push(issueRef);
			return { attempted: true, committed: false, pushed: false, branch: 'agent/issue-423', detail: 'no local work to preserve' };
		},
		findOpenPrUrl: async () => undefined,
		comments: {
			listComments: async () => record.comments.map((c) => ({ body: c.body })),
			createComment: async (issueRef, body) => void record.comments.push({ issueRef, body }),
		},
		log: (level, message, attributes) => void record.logs.push({ level, message, attributes }),
		...overrides,
	};
	return { deps, record };
}

const settledEvent = (overrides = {}) => ({
	type: 'submission_settled',
	agentName: 'Coding',
	instanceId: 'github:v1:owner:Stock-GPT:repo:marketsavvy:issue:423',
	submissionId: 'sub-1',
	outcome: 'failed',
	error: { type: 'SubmissionTimeoutError' },
	...overrides,
});

// The incident's terminal shape: a run that burned its full budget and
// settled failed must checkpoint and comment — from outside the agent.
test('a failed Coding settlement checkpoints and posts a deduplicated blocker comment', async () => {
	const { deps, record } = settlementDeps();
	await handleCodingSettlement(settledEvent(), deps);
	assert.equal(record.checkpoints.length, 1);
	assert.deepEqual(record.checkpoints[0], ref);
	assert.equal(record.comments.length, 1);
	assert.equal(record.comments[0].issueRef.issueNumber, 423);
	assert.match(record.comments[0].body, /settled as failed/);
	assert.ok(record.comments[0].body.includes(failsafeMarker('settled:sub-1')));

	// Redelivery of the same settlement (at-least-once) does not double-post.
	await handleCodingSettlement(settledEvent(), deps);
	assert.equal(record.comments.length, 1);
});

test('non-failed outcomes, other agents, and foreign events are ignored', async () => {
	const { deps, record } = settlementDeps();
	await handleCodingSettlement(settledEvent({ outcome: 'aborted' }), deps);
	await handleCodingSettlement(settledEvent({ outcome: 'completed' }), deps);
	await handleCodingSettlement(settledEvent({ agentName: 'BugTriage' }), deps);
	await handleCodingSettlement({ type: 'turn' }, deps);
	assert.equal(record.checkpoints.length, 0);
	assert.equal(record.comments.length, 0);
});

test('a throwing checkpoint still produces the blocker comment, describing the loss', async () => {
	const { deps, record } = settlementDeps({
		checkpoint: async () => {
			throw new Error('sandbox is gone');
		},
	});
	await handleCodingSettlement(settledEvent(), deps);
	assert.equal(record.comments.length, 1);
	assert.match(record.comments[0].body, /checkpoint threw: sandbox is gone/);
});

test('an unparseable instance id is logged, not thrown', async () => {
	const { deps, record } = settlementDeps();
	await handleCodingSettlement(settledEvent({ instanceId: 'not-an-issue-instance' }), deps);
	assert.equal(record.comments.length, 0);
	assert.equal(record.logs.filter((l) => l.level === 'error').length, 1);
});

test('a failing comment API is contained and logged — the observer never throws', async () => {
	const { deps, record } = settlementDeps({
		comments: {
			listComments: async () => [],
			createComment: async () => {
				throw new Error('403');
			},
		},
	});
	await assert.doesNotReject(handleCodingSettlement(settledEvent(), deps));
	assert.equal(record.logs.filter((l) => l.level === 'error').length, 1);
});
