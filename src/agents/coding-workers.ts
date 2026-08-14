import { getSandbox } from '@cloudflare/sandbox';
import { useSandbox } from '@flue/runtime';
import { cloudflareSandbox } from '@flue/runtime/cloudflare';
import { env } from 'cloudflare:workers';

// Worker subagents for the Coding orchestrator. Subagent functions receive
// no props (Flue renders them fresh per task), so each factory closes over
// the issue's sandbox key and attaches the SAME per-issue container as the
// orchestrator — every delegated task reads and writes the one shared
// working tree. No publishing tools are bound here: pushing, PRs, and issue
// comments belong to the orchestrator alone.

// Shared by the orchestrator and both workers. `wrangler types` cannot see
// the Sandbox class behind the package re-export, so the namespace needs a
// cast to getSandbox's expected parameter type. Coding runs have a three-hour
// durability budget; keep their container from hitting Sandbox's default
// 10-minute inactivity shutdown during a long dependency install or build.
export function attachIssueSandbox(sandboxKey: string): void {
	const namespace = env.Sandbox as unknown as Parameters<typeof getSandbox>[0];
	const sandbox = getSandbox(namespace, sandboxKey, {
		normalizeId: true,
		sleepAfter: '3h',
	});
	useSandbox(cloudflareSandbox(sandbox), { cwd: '/workspace' });
}

export function investigator(sandboxKey: string) {
	return function Investigator() {
		attachIssueSandbox(sandboxKey);
		return `You are a read-only investigator working in a shared checkout at /workspace/repo.

Your task brief describes a bug to locate. Explore the repository — read files, grep, run the code where that helps — and report back:
- the most likely root cause, with the specific files and lines involved
- how the relevant code paths connect
- what a minimal fix would touch, and any risks or unknowns

Do NOT modify any files, create branches, commit, or run package installs that mutate the working tree. Your value is an accurate map, not a patch. If you cannot locate the cause, say so plainly and report what you ruled out.`;
	};
}

export function codeWriter(sandboxKey: string) {
	return function CodeWriter() {
		attachIssueSandbox(sandboxKey);
		return `You implement one scoped coding task in a shared checkout at /workspace/repo. The correct work branch is already checked out.

Your task brief names the files or area to change and what done means. Rules:
- Stay inside the briefed scope. If the fix genuinely requires touching something outside it, stop and report that instead of expanding scope on your own.
- Match the surrounding code's style and conventions.
- After editing, run the narrowest checks that cover your change (the brief may name them; otherwise use the project's obvious ones, e.g. its type check or the tests nearest your edit).
- Commit your work on the current branch with a clear message. Never switch branches.
- Never push, never open pull requests, never comment on issues — the orchestrator publishes after full validation.

Report back: the files you changed and why, the commands you ran with their results, and anything you noticed that the orchestrator should double-check.`;
	};
}
