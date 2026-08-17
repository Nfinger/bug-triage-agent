import { observe } from '@flue/runtime';
import { Coding } from './agents/coding.ts';
import { checkpointPartialWork, getIssueBreaker } from './agents/coding-sandbox.ts';
import { client } from './channels/github-client.ts';
import { channel as github } from './channels/github.ts';
import { issueCommentClient } from './tools/github-issues.ts';
import { workBranch } from './tools/github-pr.ts';
import {
	handleCodingSettlement,
	type IssueRef,
	type SettlementEvent,
} from './tools/publication-failsafe.ts';

// Terminal fail-closed publication for coding runs. A submission that dies
// without settling `completed` — budget exhausted, retries exhausted — never
// runs another model turn, so nothing inside the agent can report the
// outcome. This observer is the layer that still can: it checkpoints the
// sandbox work branch and posts a blocker comment on the originating issue.
// Deliberate aborts (coding label removed) stay silent.
//
// The observe() contract runs subscribers synchronously and does not await
// returned promises, but it tracks them for rejection and Cloudflare drains
// in-flight deliveries at invocation boundaries, so the async work here is
// safe to start from the emit path.

async function findOpenPrUrl(ref: IssueRef): Promise<string | undefined> {
	const { data } = await client.rest.pulls.list({
		owner: ref.owner,
		repo: ref.repo,
		head: `${ref.owner}:${workBranch(ref.issueNumber)}`,
		state: 'open',
	});
	return data[0]?.html_url;
}

export function registerCodingFailsafe(): void {
	observe((event) => {
		if (event.type !== 'submission_settled') return;
		void handleCodingSettlement(event as SettlementEvent, {
			codingAgentName: Coding.name,
			parseInstanceId: (id) => github.parseInstanceId(id),
			workBranch,
			breakerStatus: (ref) => getIssueBreaker(ref).status(),
			checkpoint: (ref) => checkpointPartialWork(ref),
			findOpenPrUrl,
			comments: issueCommentClient(),
			log: (level, message, attributes) => {
				console[level === 'error' ? 'error' : 'log'](`[failsafe] ${message}`, attributes);
			},
		});
	});
}
