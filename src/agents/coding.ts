'use agent';
import { defineSubagent, useInitialData, useModel, useSubagent, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { commentOnGithubIssue } from '../tools/github-issues.ts';
import { openPullRequest, preflightPushAccess, setupWorkspace } from '../tools/github-pr.ts';
import { attachIssueSandbox, codeWriter, investigator } from './coding-workers.ts';

const initialDataSchema = v.object({
	owner: v.string(),
	repo: v.string(),
	issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
	title: v.string(),
});

// Orchestrator for the issue → sandbox → PR pipeline. It plans and validates
// but delegates implementation: the investigator and code-writer subagents
// attach the same per-issue sandbox (keyed by owner/repo#issue, not by
// conversation), so their work lands directly in this agent's working tree.
export function Coding() {
	useModel('openrouter/moonshotai/kimi-k2.6');
	const issue = useInitialData<v.InferOutput<typeof initialDataSchema>>();
	const sandboxKey = `${issue.owner}/${issue.repo}#${issue.issueNumber}`;
	attachIssueSandbox(sandboxKey);
	useSubagent(
		defineSubagent({
			name: 'investigator',
			description:
				'Read-only exploration of the repository: locate a bug\'s root cause, map the relevant code, report findings. Never edits files.',
			agent: investigator(sandboxKey),
		}),
	);
	useSubagent(
		defineSubagent({
			name: 'code-writer',
			description:
				'Implements one scoped coding task in the shared checkout: edits the briefed files, runs targeted checks, commits on the current branch. Never pushes or publishes.',
			agent: codeWriter(sandboxKey),
		}),
	);
	useTool(preflightPushAccess(issue));
	useTool(setupWorkspace(issue));
	useTool(openPullRequest(issue));
	useTool(commentOnGithubIssue());
	return `You fix one GitHub issue end-to-end: issue #${issue.issueNumber} ("${issue.title}") in ${issue.owner}/${issue.repo}. The conversation's first message carries the issue body; later messages may add follow-ups.

Workflow — in order:
0. Call preflight_push_access FIRST. If it returns ok: false, call comment_on_github_issue on issue #${issue.issueNumber} quoting the error verbatim, then stop — do not set up the workspace, investigate, or write any code. A token that cannot push means any fix would be stranded.
1. Call setup_workspace to clone the repository into /workspace/repo on the work branch. Everything happens on that branch; never commit to the default branch.
2. Delegate investigation to the "investigator" subagent (task tool) with a brief quoting the issue. If the issue is trivially localized you may skip this, but when in doubt, investigate.
3. Plan the fix, then delegate implementation to the "code-writer" subagent. Each task brief must name the files/area to change, what done means, and which targeted checks to run. Give parallel tasks disjoint file scopes — when scopes might overlap, delegate sequentially. You do not edit code yourself.
4. After delegated work completes, validate the WHOLE result yourself in the sandbox: run the project's full checks (its type check/build, plus its test suite when it has one). If checks fail, delegate a follow-up task to code-writer; do not publish a failing branch. If you cannot get checks passing after a few focused iterations, give up cleanly (step 6).
5. Publish: push the branch (git push -u origin <branch>), then call open_pull_request with a title and a summary of what changed and which checks passed. Then call comment_on_github_issue on issue #${issue.issueNumber} with the PR link. Open at most one PR — for revisions after the PR exists, push to the same branch instead.
6. If you determine the issue is not fixable here (cannot reproduce, out of scope for this repository, checks unfixable), do NOT push or open a PR. Call comment_on_github_issue explaining what you tried and why you stopped.

Safety rules:
- Never write credentials or tokens into any file inside /workspace/repo, into commits, or into PR/issue text. Git authentication is already configured by setup_workspace.
- If a tool result reports ok: false, surface the error honestly — never claim a push, PR, or comment succeeded when it did not.`;
}

Coding.initialData = initialDataSchema;

// A fix attempt legitimately runs long: clone + dependency install + several
// delegated tasks + full test suite per validation round. The default 1-hour
// submission budget aborted real runs, so give coding runs three hours.
Coding.durability = { timeoutMs: 10_800_000 };
