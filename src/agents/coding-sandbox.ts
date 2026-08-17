import { getSandbox } from '@cloudflare/sandbox';
import {
	createBashTool,
	createEditTool,
	createGlobTool,
	createGrepTool,
	createReadTool,
	createWriteTool,
	type SandboxToolFactory,
	useSandbox,
} from '@flue/runtime';
import { cloudflareSandbox } from '@flue/runtime/cloudflare';
import { env } from 'cloudflare:workers';
import { checkpointWorkBranch, type CheckpointOutcome } from '../tools/checkpoint.ts';
import { withDeadline } from '../tools/deadline.ts';
import {
	createFailureBreaker,
	type FailureBreaker,
	guardSandboxTool,
} from '../tools/failure-breaker.ts';
import { workBranch } from '../tools/github-pr.ts';

// Cloudflare-only sandbox plumbing for the coding agent, kept out of
// coding-workers.ts so the worker agent functions (and the pure failure
// logic) stay importable in Node tests. ONLY the orchestrator attaches the
// sandbox: Flue delegates inherit the parent's environment, and calling
// useSandbox() in a subagent render throws — that exact mistake broke every
// investigator/code-writer delegation in the 2026-08-16 incident.

export interface IssueSandboxRef {
	owner: string;
	repo: string;
	issueNumber: number;
}

export function issueSandboxKey(ref: IssueSandboxRef): string {
	return `${ref.owner}/${ref.repo}#${ref.issueNumber}`;
}

// One breaker per issue, per isolate. Isolate-lifetime by design: a Durable
// Object restart starts a clean count, and useAgentStart resets it per
// submission so a label-triggered retry never inherits a stale trip. Bounded
// FIFO so a long-lived isolate cannot grow this without limit.
const breakers = new Map<string, FailureBreaker>();
const MAX_TRACKED_ISSUES = 200;

export function getIssueBreaker(ref: IssueSandboxRef): FailureBreaker {
	const key = issueSandboxKey(ref);
	let breaker = breakers.get(key);
	if (!breaker) {
		breaker = createFailureBreaker({ issueNumber: ref.issueNumber });
		breakers.set(key, breaker);
		if (breakers.size > MAX_TRACKED_ISSUES) {
			const oldest = breakers.keys().next().value;
			if (oldest !== undefined) breakers.delete(oldest);
		}
	}
	return breaker;
}

/**
 * The framework's standard six sandbox tools, each wrapped with the issue's
 * failure breaker: repeated identical failures redirect and then disable the
 * sandbox tool set, and results carry deadline notices near the budget's end.
 */
export function guardedSandboxTools(breaker: FailureBreaker): SandboxToolFactory {
	return (sandbox) =>
		[
			createReadTool(sandbox),
			createWriteTool(sandbox),
			createEditTool(sandbox),
			createBashTool(sandbox),
			createGrepTool(sandbox),
			createGlobTool(sandbox),
		].map((tool) => guardSandboxTool(tool, breaker));
}

function sandboxFor(ref: IssueSandboxRef) {
	// `wrangler types` cannot see the Sandbox class behind the package
	// re-export, so the namespace needs a cast to getSandbox's parameter type.
	const namespace = env.Sandbox as unknown as Parameters<typeof getSandbox>[0];
	// Coding runs have a three-hour durability budget; keep the container from
	// hitting Sandbox's default 10-minute inactivity shutdown mid-run.
	return getSandbox(namespace, issueSandboxKey(ref), {
		normalizeId: true,
		sleepAfter: '3h',
	});
}

/**
 * Attach the per-issue container to the ORCHESTRATOR (never call from a
 * subagent render). `deadlineAt` is the durable hard deadline recorded by
 * useAgentStart; syncing it every render keeps deadline warnings working
 * across isolate restarts.
 */
export function attachIssueSandbox(
	ref: IssueSandboxRef,
	options?: { deadlineAt?: number | null },
): void {
	const breaker = getIssueBreaker(ref);
	breaker.syncDeadline(options?.deadlineAt);
	const sandbox = sandboxFor(ref);
	useSandbox(
		{ ...cloudflareSandbox(sandbox), tools: guardedSandboxTools(breaker) },
		{ cwd: '/workspace' },
	);
}

/**
 * Terminal checkpoint used by the settlement failsafe: refresh git identity
 * and credentials (the container may have restarted since setup_workspace),
 * then commit and push whatever the run left behind. Never throws.
 */
export async function checkpointPartialWork(ref: IssueSandboxRef): Promise<CheckpointOutcome> {
	const branch = workBranch(ref.issueNumber);
	const sandbox = sandboxFor(ref);
	// The SDK's `timeout` is enforced container-side, which is worthless when
	// the container itself is gone — the incident's exact shape — so every
	// call also gets an independent caller deadline.
	const exec = async (command: string, timeoutMs: number) => {
		const result = await withDeadline(
			sandbox.exec(command, { timeout: timeoutMs }),
			timeoutMs + 15_000,
			'checkpoint command',
		);
		return {
			exitCode: result.exitCode ?? (result.success ? 0 : 1),
			stdout: result.stdout ?? '',
			stderr: result.stderr ?? '',
		};
	};
	try {
		const token = process.env.GITHUB_TOKEN;
		if (token) {
			// Same discipline as setup_workspace: the token goes through
			// writeFile into git's store outside the repo, never a shell string.
			await withDeadline(
				sandbox.writeFile('/root/.git-credentials', `https://x-access-token:${token}@github.com\n`),
				30_000,
				'checkpoint credential write',
			);
			await exec(
				`git config --global credential.helper 'store --file /root/.git-credentials' && ` +
					`git config --global user.name 'coding-agent' && ` +
					`git config --global user.email 'coding-agent@noreply.invalid'`,
				30_000,
			);
		}
	} catch {
		// Credential refresh is best-effort; the push step reports its own failure.
	}
	return checkpointWorkBranch(exec, branch);
}
