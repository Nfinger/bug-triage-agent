import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { client } from '../channels/github-client.ts';

/** The issue a coding-agent conversation is working on. */
export interface CodingIssueRef {
	owner: string;
	repo: string;
	issueNumber: number;
}

export function workBranch(issueNumber: number): string {
	return `agent/issue-${issueNumber}`;
}

function errorOutput(error: unknown): { ok: false; error: string } {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

type SetupWorkspaceOutput =
	| { ok: true; path: string; branch: string; defaultBranch: string; install: string }
	| { ok: false; error: string };

/**
 * Clone the configured repository into the per-issue sandbox and check out
 * the work branch. Runs against `harness.sandbox`, so the GitHub token never
 * enters the model conversation: it is written to a git credential store
 * outside the repository working tree and referenced by git's credential
 * helper. Idempotent — safe to call again after a sandbox restart.
 */
export function setupWorkspace(ref: CodingIssueRef) {
	return defineTool({
		name: 'setup_workspace',
		description:
			'Clone the repository for this issue into /workspace/repo and check out the work branch. ' +
			'Call this once before any investigation or code changes. Safe to re-run: an existing ' +
			'clone is fetched and reused. Returns the repo path, work branch, and default branch.',
		input: v.object({}),
		harness: true,
		async run({ harness, log }): Promise<{ output: SetupWorkspaceOutput }> {
			const { owner, repo, issueNumber } = ref;
			const token = process.env.GITHUB_TOKEN;
			if (!token) return { output: { ok: false, error: 'GITHUB_TOKEN is not configured' } };
			const branch = workBranch(issueNumber);
			const path = '/workspace/repo';
			const startedAt = Date.now();
			try {
				// Credentials live in git's store outside the working tree — never
				// in the clone URL, shell history inside the repo, or any file that
				// could be committed.
				await harness.sandbox.writeFile(
					'/root/.git-credentials',
					`https://x-access-token:${token}@github.com\n`,
				);
				const setup = [
					`git config --global credential.helper 'store --file /root/.git-credentials'`,
					// NOT @users.noreply.github.com — GitHub maps that domain to the
					// account named in the local part, attributing our commits to
					// whichever real user happens to own that username. The reserved
					// .invalid TLD guarantees the email maps to no account.
					`git config --global user.name 'coding-agent'`,
					`git config --global user.email 'coding-agent@noreply.invalid'`,
				].join(' && ');
				const configured = await harness.sandbox.exec(setup);
				if (configured.exitCode !== 0) {
					return { output: { ok: false, error: `git config failed: ${configured.stderr}` } };
				}
				if (!(await harness.sandbox.exists(`${path}/.git`))) {
					// Partial clone: full history, blobs fetched on demand — much
					// faster than a full clone on large repositories.
					const cloned = await harness.sandbox.exec(
						`git clone --filter=blob:none https://github.com/${owner}/${repo}.git ${path}`,
						{ timeoutMs: 300_000 },
					);
					if (cloned.exitCode !== 0) {
						return { output: { ok: false, error: `git clone failed: ${cloned.stderr}` } };
					}
				} else {
					const fetched = await harness.sandbox.exec(`git -C ${path} fetch origin`, {
						timeoutMs: 120_000,
					});
					if (fetched.exitCode !== 0) {
						return { output: { ok: false, error: `git fetch failed: ${fetched.stderr}` } };
					}
				}
				const head = await harness.sandbox.exec(
					`git -C ${path} symbolic-ref --short refs/remotes/origin/HEAD || git -C ${path} rev-parse --abbrev-ref HEAD`,
				);
				const defaultBranch = head.stdout.trim().replace(/^origin\//, '') || 'main';
				const checkedOut = await harness.sandbox.exec(
					`git -C ${path} rev-parse --verify ${branch} >/dev/null 2>&1 && git -C ${path} checkout ${branch} || git -C ${path} checkout -b ${branch} origin/${defaultBranch}`,
				);
				if (checkedOut.exitCode !== 0) {
					return { output: { ok: false, error: `branch checkout failed: ${checkedOut.stderr}` } };
				}
				// Install dependencies deterministically while we're here: the
				// image's pre-warmed pnpm store makes this mostly a link step.
				// Failure is reported but doesn't fail setup — the agent can
				// investigate or retry the install itself.
				let install = 'skipped (no pnpm-lock.yaml)';
				if (await harness.sandbox.exists(`${path}/pnpm-lock.yaml`)) {
					const installed = await harness.sandbox.exec(
						`cd ${path} && pnpm install --prefer-offline --frozen-lockfile`,
						{ timeoutMs: 900_000 },
					);
					install =
						installed.exitCode === 0
							? 'ok'
							: `failed: ${installed.stderr.slice(-500)}`;
				}
				log.info('workspace ready', {
					repo: `${owner}/${repo}`,
					issueNumber,
					branch,
					install,
					durationMs: Date.now() - startedAt,
				});
				return { output: { ok: true, path, branch, defaultBranch, install } };
			} catch (error) {
				log.error('workspace setup failed', {
					repo: `${owner}/${repo}`,
					issueNumber,
					error: errorOutput(error).error,
					durationMs: Date.now() - startedAt,
				});
				return { output: errorOutput(error) };
			}
		},
	});
}

/**
 * Open the pull request for this issue's work branch. At most one PR per
 * issue: if an open PR for the branch already exists, it is returned instead
 * of creating a duplicate. Pushing the branch happens in the sandbox (git
 * credential helper) before this is called.
 */
export function openPullRequest(ref: CodingIssueRef) {
	return defineTool({
		name: 'open_pull_request',
		description:
			'Open a pull request from this issue\'s work branch against the default branch. ' +
			'Push the branch first (git push -u origin <branch>). The PR body automatically ' +
			'links the issue with a closing keyword. Idempotent: returns the existing open PR ' +
			'for the branch if one exists.',
		input: v.object({
			title: v.pipe(v.string(), v.minLength(1)),
			summary: v.pipe(
				v.string(),
				v.minLength(1),
				v.description('What was changed and how it was validated (checks run, results).'),
			),
		}),
		async run({ data, log }) {
			const { owner, repo, issueNumber } = ref;
			const branch = workBranch(issueNumber);
			try {
				const existing = await client.rest.pulls.list({
					owner,
					repo,
					head: `${owner}:${branch}`,
					state: 'open',
				});
				if (existing.data.length > 0) {
					const pr = existing.data[0];
					log.info('pull request already open', { repo: `${owner}/${repo}`, issueNumber, prNumber: pr.number });
					return {
						output: { ok: true as const, prNumber: pr.number, url: pr.html_url, alreadyExisted: true },
					};
				}
				const repoInfo = await client.rest.repos.get({ owner, repo });
				const created = await client.rest.pulls.create({
					owner,
					repo,
					title: data.title,
					head: branch,
					base: repoInfo.data.default_branch,
					body: `${data.summary}\n\nFixes #${issueNumber}`,
				});
				log.info('pull request opened', {
					repo: `${owner}/${repo}`,
					issueNumber,
					prNumber: created.data.number,
				});
				return {
					output: {
						ok: true as const,
						prNumber: created.data.number,
						url: created.data.html_url,
						alreadyExisted: false,
					},
				};
			} catch (error) {
				log.error('pull request open failed', {
					repo: `${owner}/${repo}`,
					issueNumber,
					error: errorOutput(error).error,
				});
				return { output: errorOutput(error) };
			}
		},
	});
}
