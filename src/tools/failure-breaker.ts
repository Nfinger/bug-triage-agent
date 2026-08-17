// Failure governance for the coding agent's sandbox tools. Pure logic —
// no Cloudflare imports — so the loop-stopping behavior is unit-testable.
//
// Why this exists: tool errors are returned to the model as error results
// and the agent loop happily continues. In the 2026-08-16 incident, runs
// whose sandbox container was unavailable looped on immediately-failing
// bash/glob/read calls for their entire three-hour budget and published
// nothing. The breaker bounds that failure mode: repeated identical
// failures first redirect the model, then trip the breaker so every
// further sandbox call fails fast with an instruction to publish a
// blocker comment instead. It also carries the run deadline so tool
// results can warn the model to checkpoint before the budget expires.

/** Total wall-clock budget of one coding run. MUST equal Coding.durability.timeoutMs. */
export const CODING_RUN_BUDGET_MS = 10_800_000;

/** Reserved tail of the budget: once inside it, publishing beats more fixing. */
export const DEADLINE_SAFETY_MS = 10 * 60 * 1000;

/** How far from the hard deadline the first checkpoint warnings start. */
export const DEADLINE_WARNING_MS = 20 * 60 * 1000;

/** Minimum spacing between deadline notices so results aren't drowned in them. */
export const DEADLINE_NOTICE_THROTTLE_MS = 4 * 60 * 1000;

/** Identical failures of one tool before guidance is appended to the error. */
export const IDENTICAL_FAILURE_WARN_AFTER = 3;

/** Identical failures of one tool before the breaker trips. */
export const IDENTICAL_FAILURE_TRIP_AFTER = 5;

/** Consecutive sandbox-tool failures (any mix) before the breaker trips. */
export const CONSECUTIVE_FAILURE_TRIP_AFTER = 12;

export interface BreakerStatus {
	tripped: boolean;
	tripReason?: string;
	consecutiveFailures: number;
	lastFailure?: { tool: string; message: string; identicalCount: number };
}

/**
 * Collapse the volatile parts of an error message (ids, counters, timestamps)
 * so retries of the same broken call count as identical even when the provider
 * stamps each failure differently.
 */
export function normalizeFailureSignature(toolName: string, message: string): string {
	return `${toolName}:${message
		.toLowerCase()
		.replace(/[0-9a-f]{8,}/g, '#')
		.replace(/\d+/g, '#')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 240)}`;
}

function isAbortLike(error: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) return true;
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error as { name?: unknown }).name === 'AbortError'
	);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface FailureBreaker {
	/** Reset counters and trip state for a fresh submission; record its hard deadline. */
	startRun(hardDeadlineAt: number): void;
	/** Re-sync the durable deadline on each render (survives isolate restarts). */
	syncDeadline(hardDeadlineAt: number | null | undefined): void;
	/** Throws fast when the breaker has tripped — called before executing a sandbox tool. */
	guardToolCall(toolName: string): void;
	recordSuccess(): void;
	/**
	 * Count a failure and return the error to surface to the model: the
	 * original error, or one whose message carries redirect/trip guidance.
	 * Aborts (deadline or cancellation) pass through uncounted.
	 */
	noteFailure(toolName: string, error: unknown, signal?: AbortSignal): unknown;
	/** Deadline warning to append to a tool result, or undefined. Throttled. */
	deadlineNotice(): string | undefined;
	status(): BreakerStatus;
}

export function createFailureBreaker(options: {
	issueNumber: number;
	now?: () => number;
}): FailureBreaker {
	const now = options.now ?? Date.now;
	const { issueNumber } = options;

	let tripReason: string | undefined;
	let lastSignature: string | undefined;
	let identicalCount = 0;
	let consecutiveFailures = 0;
	let lastFailure: BreakerStatus['lastFailure'];
	let hardDeadlineAt: number | null = null;
	let lastNoticeAt: number | null = null;

	const publishInstruction =
		`Do not call sandbox tools again in this run. Publish what you know instead: call ` +
		`comment_on_github_issue on issue #${issueNumber} describing what you attempted and the ` +
		`failure, then stop. If you pushed any commits, name the branch in the comment.`;

	function tripMessage(toolName: string, reason: string): string {
		return (
			`[harness] Sandbox tools are disabled for this run: ${reason} ` +
			`(most recent: ${toolName}). The sandbox environment is unusable. ${publishInstruction}`
		);
	}

	function remainingMs(): number | null {
		return hardDeadlineAt === null ? null : hardDeadlineAt - now();
	}

	// Standalone (not a method) so noteFailure can reuse it without relying on
	// `this` binding — the breaker is passed around and may be destructured.
	function deadlineNotice(): string | undefined {
		const remaining = remainingMs();
		if (remaining === null || remaining > DEADLINE_WARNING_MS) return undefined;
		const at = now();
		if (lastNoticeAt !== null && at - lastNoticeAt < DEADLINE_NOTICE_THROTTLE_MS) {
			return undefined;
		}
		lastNoticeAt = at;
		const minutes = Math.max(0, Math.floor(remaining / 60_000));
		if (remaining <= DEADLINE_SAFETY_MS) {
			return (
				`[harness] DEADLINE: ${minutes <= 0 ? 'the fix budget is exhausted' : `under ${Math.max(minutes, 1)} minutes of fix budget remain`} — ` +
				`this run is about to be aborted. Publish immediately: commit and push the work ` +
				`branch now, then open the pull request if checks passed, otherwise call ` +
				`comment_on_github_issue on issue #${issueNumber} with a blocker report. Start no new work.`
			);
		}
		return (
			`[harness] Deadline approaching: about ${minutes} minutes of fix budget remain. ` +
			`Begin checkpointing: commit your work and push the branch, then finish with either ` +
			`the pull request or a blocker comment on issue #${issueNumber}. Do not start new ` +
			`long-running work.`
		);
	}

	return {
		startRun(deadline) {
			tripReason = undefined;
			lastSignature = undefined;
			identicalCount = 0;
			consecutiveFailures = 0;
			lastFailure = undefined;
			hardDeadlineAt = deadline;
			lastNoticeAt = null;
		},

		syncDeadline(deadline) {
			if (typeof deadline === 'number') hardDeadlineAt = deadline;
		},

		guardToolCall(toolName) {
			if (tripReason !== undefined) throw new Error(tripMessage(toolName, tripReason));
		},

		recordSuccess() {
			lastSignature = undefined;
			identicalCount = 0;
			consecutiveFailures = 0;
		},

		noteFailure(toolName, error, signal) {
			if (isAbortLike(error, signal)) return error;
			const message = messageOf(error);
			const signature = normalizeFailureSignature(toolName, message);
			identicalCount = signature === lastSignature ? identicalCount + 1 : 1;
			lastSignature = signature;
			consecutiveFailures += 1;
			lastFailure = { tool: toolName, message, identicalCount };

			if (identicalCount >= IDENTICAL_FAILURE_TRIP_AFTER) {
				tripReason = `${identicalCount} consecutive identical ${toolName} failures ("${message.slice(0, 200)}")`;
			} else if (consecutiveFailures >= CONSECUTIVE_FAILURE_TRIP_AFTER) {
				tripReason = `${consecutiveFailures} consecutive sandbox tool failures`;
			}
			if (tripReason !== undefined) return new Error(tripMessage(toolName, tripReason));

			const notice = deadlineNotice();
			if (identicalCount >= IDENTICAL_FAILURE_WARN_AFTER) {
				return new Error(
					`${message}\n\n[harness] This identical ${toolName} call has now failed ` +
						`${identicalCount} times in a row. Do not repeat it. Change your approach; if the ` +
						`sandbox itself is broken, call comment_on_github_issue on issue #${issueNumber} ` +
						`to report the blocker and stop.${notice ? `\n${notice}` : ''}`,
				);
			}
			if (notice) return new Error(`${message}\n\n${notice}`);
			return error;
		},

		deadlineNotice,

		status() {
			return {
				tripped: tripReason !== undefined,
				...(tripReason !== undefined ? { tripReason } : {}),
				consecutiveFailures,
				...(lastFailure ? { lastFailure } : {}),
			};
		},
	};
}

/**
 * The subset of a Flue sandbox tool the guard needs: everything else on the
 * tool object passes through untouched.
 */
interface GuardableTool {
	name: string;
	execute(
		toolCallId: string,
		params: unknown,
		signal?: AbortSignal,
		onUpdate?: (partial: unknown) => void,
	): Promise<unknown>;
}

/**
 * Wrap one sandbox tool with the breaker: fail fast once tripped, count
 * failures, and append deadline notices to successful results. Framework
 * semantics are preserved — errors still throw (the agent loop renders them
 * as error tool results), successes keep their shape.
 */
export function guardSandboxTool<T extends GuardableTool>(tool: T, breaker: FailureBreaker): T {
	return {
		...tool,
		async execute(
			toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
			onUpdate?: (partial: unknown) => void,
		) {
			breaker.guardToolCall(tool.name);
			let result: unknown;
			try {
				result = await tool.execute(toolCallId, params, signal, onUpdate);
			} catch (error) {
				throw breaker.noteFailure(tool.name, error, signal);
			}
			breaker.recordSuccess();
			const notice = breaker.deadlineNotice();
			if (
				notice &&
				typeof result === 'object' &&
				result !== null &&
				Array.isArray((result as { content?: unknown }).content)
			) {
				const shaped = result as { content: unknown[] };
				return { ...shaped, content: [...shaped.content, { type: 'text', text: notice }] };
			}
			return result;
		},
	};
}
