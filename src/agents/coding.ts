'use agent';
import {
	defineSubagent,
	useAgentFinish,
	useAgentStart,
	useInitialData,
	useModel,
	usePersistentState,
	useSubagent,
	useTool,
} from '@flue/runtime';
import * as v from 'valibot';
import { commentOnGithubIssue, issueCommentClient } from '../tools/github-issues.ts';
import { openPullRequest, preflightPushAccess, setupWorkspace, workBranch } from '../tools/github-pr.ts';
import { CODING_RUN_BUDGET_MS } from '../tools/failure-breaker.ts';
import {
	buildBlockerComment,
	enforcementSignal,
	nextEnforcementAction,
	postBlockerCommentOnce,
	publicationOutcome,
} from '../tools/publication-failsafe.ts';
import { attachIssueSandbox, getIssueBreaker } from './coding-sandbox.ts';
import { CodeWriter, Investigator } from './coding-workers.ts';

const initialDataSchema = v.object({
	owner: v.string(),
	repo: v.string(),
	issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
	title: v.string(),
});

// Orchestrator for the issue → sandbox → PR pipeline. It plans and validates
// but delegates implementation: the investigator and code-writer subagents
// inherit this agent's per-issue sandbox (Flue delegates share the parent's
// environment — they must NOT attach one themselves), so their work lands
// directly in this agent's working tree.
export function Coding() {
	// Orchestration needs a model that reliably delegates and follows the
	// publish contract: kimi-k2.6 completed zero fixes and ignored two
	// publication-enforcement redirects in the 2026-08-17 rerun of issue #495.
	useModel('openrouter/anthropic/claude-sonnet-4.6');
	const issue = useInitialData<v.InferOutput<typeof initialDataSchema>>();
	const breaker = getIssueBreaker(issue);
	// The hard deadline is durable state so deadline warnings survive isolate
	// restarts; useAgentStart records it once per delivered message.
	const [runDeadlineAt, setRunDeadlineAt] = usePersistentState<number | null>('runDeadlineAt', null);
	const [enforcements, setEnforcements] = usePersistentState('publicationEnforcements', 0);
	attachIssueSandbox(issue, { deadlineAt: runDeadlineAt });
	useSubagent(
		defineSubagent({
			name: 'investigator',
			description:
				'Read-only exploration of the repository: locate a bug\'s root cause, map the relevant code, report findings. Never edits files.',
			agent: Investigator,
		}),
	);
	useSubagent(
		defineSubagent({
			name: 'code-writer',
			description:
				'Implements one scoped coding task in the shared checkout: edits the briefed files, runs targeted checks, commits on the current branch. Never pushes or publishes.',
			agent: CodeWriter,
		}),
	);
	useTool(preflightPushAccess(issue));
	useTool(setupWorkspace(issue));
	useTool(openPullRequest(issue));
	useTool(commentOnGithubIssue());

	useAgentStart(() => {
		// Fresh budget clock and a clean breaker per submission: a label-removal
		// retry must not inherit a stale trip or a spent deadline.
		const deadline = Date.now() + CODING_RUN_BUDGET_MS;
		setRunDeadlineAt(deadline);
		setEnforcements(0);
		breaker.startRun(deadline);
	});

	// Fail-closed publication: a response may not settle without either a PR
	// or an issue comment. Redirect the model a bounded number of times; after
	// that, post the blocker comment directly so the issue is never left silent.
	useAgentFinish(async (ctx) => {
		const outcome = publicationOutcome(ctx.response.toolCalls);
		const action = nextEnforcementAction(outcome, enforcements);
		if (action === 'settle') return;
		if (action === 'redirect') {
			setEnforcements((n) => n + 1);
			ctx.append(enforcementSignal(issue, enforcements + 1));
			return;
		}
		const body = buildBlockerComment({
			ref: issue,
			reason: 'no-publication',
			branch: workBranch(issue.issueNumber),
			breaker: breaker.status(),
		});
		ctx.log.info('publication enforcement exhausted; posting blocker comment directly', {
			issueNumber: issue.issueNumber,
		});
		// A failure here rethrows on purpose: failing the submission hands the
		// job to the settlement failsafe, which retries the comment with
		// checkpoint context — the one outcome never allowed is silence.
		await postBlockerCommentOnce(
			issueCommentClient(),
			issue,
			`finish:${issue.issueNumber}:${runDeadlineAt ?? 0}`,
			body,
		);
	});

	return `You fix one GitHub issue end-to-end: issue #${issue.issueNumber} ("${issue.title}") in ${issue.owner}/${issue.repo}. The conversation's first message carries the issue body; later messages may add follow-ups.

Workflow — in order:
0. Call preflight_push_access FIRST. If it returns ok: false, call comment_on_github_issue on issue #${issue.issueNumber} quoting the error verbatim, then stop — do not set up the workspace, investigate, or write any code. A token that cannot push means any fix would be stranded.
1. Call setup_workspace to clone the repository into /workspace/repo on the work branch. Everything happens on that branch; never commit to the default branch.
2. Delegate investigation to the "investigator" subagent (task tool) with a brief quoting the issue. If the issue is trivially localized you may skip this, but when in doubt, investigate.
3. Plan the fix, then delegate implementation to the "code-writer" subagent. Each task brief must name the files/area to change, what done means, and which targeted checks to run. Give parallel tasks disjoint file scopes — when scopes might overlap, delegate sequentially. You do not edit code yourself.
4. After delegated work completes, validate the WHOLE result yourself in the sandbox: run the project's full checks (its type check/build, plus its test suite when it has one). If checks fail, delegate a follow-up task to code-writer; do not publish a failing branch. If you cannot get checks passing after a few focused iterations, give up cleanly (step 6).
5. Publish: push the branch (git push -u origin <branch>), then call open_pull_request with a title and a summary of what changed and which checks passed. Then call comment_on_github_issue on issue #${issue.issueNumber} with the PR link. Open at most one PR — for revisions after the PR exists, push to the same branch instead.
6. If you determine the issue is not fixable here (cannot reproduce, out of scope for this repository, checks unfixable), do NOT push or open a PR. Call comment_on_github_issue explaining what you tried and why you stopped.

Operating limits — the harness enforces these:
- Budget: this run has a hard three-hour wall clock. When a tool result carries a "[harness] Deadline" notice, stop starting new work and checkpoint: commit, push the branch, then finish with the PR (if validated) or a blocker comment.
- Repeated failures: if a tool call fails the same way twice, do not repeat it — change approach. After a "[harness] Sandbox tools are disabled" notice, stop touching the sandbox and immediately post the blocker comment (step 6 format).
- Every run must end with either an open PR or an issue comment explaining why there is none. Ending silently is not an option; if you do not report, the harness posts a generic comment on your behalf, which is worse for the reader.

Safety rules:
- Never write credentials or tokens into any file inside /workspace/repo, into commits, or into PR/issue text. Git authentication is already configured by setup_workspace.
- If a tool result reports ok: false, surface the error honestly — never claim a push, PR, or comment succeeded when it did not.`;
}

Coding.initialData = initialDataSchema;

// A fix attempt legitimately runs long: clone + dependency install + several
// delegated tasks + full test suite per validation round. The default 1-hour
// submission budget aborted real runs, so give coding runs three hours.
// MUST stay equal to CODING_RUN_BUDGET_MS (tests assert it) — the breaker's
// deadline warnings are anchored to that constant.
Coding.durability = { timeoutMs: 10_800_000 };
