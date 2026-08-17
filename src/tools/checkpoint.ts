// Checkpoint of a coding run's partial work: commit whatever is in the
// working tree and push the work branch so a timed-out or failed run leaves
// its progress recoverable instead of dying with the sandbox. Pure logic over
// an injected exec so the sequencing is unit-testable; the Cloudflare glue
// (real sandbox exec, credential refresh) lives in agents/coding-sandbox.ts.

export interface CheckpointExec {
	(command: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface CheckpointOutcome {
	/** False when there was no clone to checkpoint (workspace never set up). */
	attempted: boolean;
	committed: boolean;
	pushed: boolean;
	branch: string;
	detail: string;
}

const REPO = '/workspace/repo';

/**
 * Commit dirty state and push the work branch when it carries any commits
 * beyond the default branch. A clean tree with no local commits is skipped
 * entirely — no empty remote branches for runs that never got started.
 * Every failure is folded into `detail`; this never throws.
 */
export async function checkpointWorkBranch(
	exec: CheckpointExec,
	branch: string,
): Promise<CheckpointOutcome> {
	const outcome: CheckpointOutcome = {
		attempted: false,
		committed: false,
		pushed: false,
		branch,
		detail: '',
	};
	try {
		const hasRepo = await exec(`test -d ${REPO}/.git`, 15_000);
		if (hasRepo.exitCode !== 0) {
			outcome.detail = 'no workspace clone to checkpoint';
			return outcome;
		}
		outcome.attempted = true;

		const status = await exec(`git -C ${REPO} status --porcelain`, 30_000);
		if (status.exitCode !== 0) {
			outcome.detail = `git status failed: ${status.stderr.trim()}`;
			return outcome;
		}
		if (status.stdout.trim().length > 0) {
			const committed = await exec(
				`git -C ${REPO} add -A && git -C ${REPO} commit -m 'wip: checkpoint of unfinished automated fix'`,
				60_000,
			);
			if (committed.exitCode !== 0) {
				outcome.detail = `checkpoint commit failed: ${committed.stderr.trim()}`;
				return outcome;
			}
			outcome.committed = true;
		}

		const head = await exec(
			`git -C ${REPO} symbolic-ref --short refs/remotes/origin/HEAD || echo origin/main`,
			15_000,
		);
		const defaultBranch = head.stdout.trim().replace(/^origin\//, '') || 'main';
		const ahead = await exec(
			`git -C ${REPO} rev-list --count origin/${defaultBranch}..HEAD`,
			30_000,
		);
		const aheadCount = Number.parseInt(ahead.stdout.trim(), 10);
		if (ahead.exitCode !== 0 || Number.isNaN(aheadCount)) {
			outcome.detail = `could not compare against origin/${defaultBranch}: ${ahead.stderr.trim()}`;
			return outcome;
		}
		if (aheadCount === 0) {
			outcome.detail = 'no local work to preserve (tree clean, no commits beyond the default branch)';
			return outcome;
		}

		const pushed = await exec(`git -C ${REPO} push -u origin ${branch}`, 120_000);
		if (pushed.exitCode !== 0) {
			outcome.detail = `push failed: ${pushed.stderr.trim()}`;
			return outcome;
		}
		outcome.pushed = true;
		outcome.detail = `${aheadCount} commit(s) preserved on ${branch}`;
		return outcome;
	} catch (error) {
		outcome.detail = `checkpoint error: ${error instanceof Error ? error.message : String(error)}`;
		return outcome;
	}
}
