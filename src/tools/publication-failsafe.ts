// Fail-closed publication for the coding agent. Two layers share this module:
//
// 1. The `useAgentFinish` enforcement seam in agents/coding.ts — when a
//    response is about to settle without a PR or an issue comment, first
//    redirect the model back to work (bounded), then post the blocker
//    comment directly.
// 2. The `submission_settled` observer registered in failsafe.ts — when a
//    run dies outright (budget exhausted, retries exhausted), checkpoint the
//    sandbox work branch and post the blocker comment, because no model turn
//    will ever run again for that submission.
//
// Everything here is pure and dependency-injected so the incident's failure
// modes ("run ends with nothing published") are unit-testable.

import type { CheckpointOutcome } from './checkpoint.ts';
import type { BreakerStatus } from './failure-breaker.ts';

export interface IssueRef {
	owner: string;
	repo: string;
	issueNumber: number;
}

export interface ResponseToolCall {
	tool: string;
	isError: boolean;
}

export interface PublicationOutcome {
	prOpened: boolean;
	commented: boolean;
	published: boolean;
}

/** Redirect the model at most this many times before commenting directly. */
export const MAX_PUBLICATION_ENFORCEMENTS = 2;

export const PR_TOOL_NAME = 'open_pull_request';
export const COMMENT_TOOL_NAME = 'comment_on_github_issue';

/**
 * What the response actually delivered, from the finish seam's aggregated
 * tool calls. Only non-error calls count — a failed comment is not a report.
 */
export function publicationOutcome(toolCalls: readonly ResponseToolCall[]): PublicationOutcome {
	const prOpened = toolCalls.some((call) => call.tool === PR_TOOL_NAME && !call.isError);
	const commented = toolCalls.some((call) => call.tool === COMMENT_TOOL_NAME && !call.isError);
	return { prOpened, commented, published: prOpened || commented };
}

export type EnforcementAction = 'settle' | 'redirect' | 'comment-directly';

/**
 * Decide what the finish seam does with a would-settle response. A response
 * that published anything settles; otherwise the model gets a bounded number
 * of redirects before the harness posts the blocker comment itself.
 */
export function nextEnforcementAction(
	outcome: PublicationOutcome,
	priorEnforcements: number,
): EnforcementAction {
	if (outcome.published) return 'settle';
	return priorEnforcements < MAX_PUBLICATION_ENFORCEMENTS ? 'redirect' : 'comment-directly';
}

export function enforcementSignal(
	ref: IssueRef,
	attempt: number,
): { kind: 'signal'; type: string; body: string; attributes: Record<string, string> } {
	return {
		kind: 'signal',
		type: 'publication.enforcement',
		body:
			`This response is about to end without any published outcome for issue ` +
			`#${ref.issueNumber}. That is not an allowed ending. Do one of the following now: ` +
			`(a) if a validated fix exists, push the branch and call ${PR_TOOL_NAME}, then link it with ` +
			`${COMMENT_TOOL_NAME}; (b) otherwise call ${COMMENT_TOOL_NAME} on issue #${ref.issueNumber} ` +
			`explaining what you tried, what failed, and what remains. Enforcement ${attempt} of ` +
			`${MAX_PUBLICATION_ENFORCEMENTS}: after the last one the harness posts a generic blocker ` +
			`comment itself, which is worse for the reader than your specific account.`,
		attributes: { issueNumber: String(ref.issueNumber), attempt: String(attempt) },
	};
}

/** HTML marker embedded in failsafe comments; keys deduplication. */
export function failsafeMarker(key: string): string {
	return `<!-- bug-triage-agent:failsafe:${key} -->`;
}

export interface BlockerCommentInput {
	ref: IssueRef;
	reason: 'no-publication' | 'run-failed';
	branch: string;
	breaker?: BreakerStatus;
	checkpoint?: CheckpointOutcome;
	errorType?: string;
	prUrl?: string;
}

/** Body of the harness-authored blocker comment (marker not included). */
export function buildBlockerComment(input: BlockerCommentInput): string {
	const { ref, reason, branch, breaker, checkpoint, errorType, prUrl } = input;
	const lines: string[] = [];
	lines.push(
		reason === 'run-failed'
			? `The automated fix run for this issue ended without completing (its submission ` +
				`settled as failed${errorType ? `: \`${errorType}\`` : ''}). No pull request was opened by the run.`
			: `The automated fix run for this issue is stopping without a reportable result, and ` +
				`the agent did not post its own summary.`,
	);
	if (breaker?.tripped && breaker.tripReason) {
		lines.push(`Sandbox tools were disabled after repeated failures: ${breaker.tripReason}.`);
	} else if (breaker?.lastFailure) {
		lines.push(
			`Last sandbox tool failure: \`${breaker.lastFailure.tool}\` — ` +
				`${breaker.lastFailure.message.slice(0, 300)}`,
		);
	}
	if (prUrl) {
		lines.push(`An open pull request already exists for this issue's work branch: ${prUrl}`);
	}
	if (checkpoint) {
		if (checkpoint.pushed) {
			lines.push(
				`Partial work was preserved: ${checkpoint.detail} — see branch \`${checkpoint.branch}\` ` +
					`in ${ref.owner}/${ref.repo}. It has NOT passed validation.`,
			);
		} else if (checkpoint.attempted) {
			lines.push(`Partial work could not be preserved (${checkpoint.detail}).`);
		} else {
			lines.push(`No workspace was set up, so there is no partial work to preserve.`);
		}
	}
	lines.push(
		`To retry: remove and re-apply the coding-agent label. If this repeats, check the ` +
			`sandbox container capacity and the agent's Wrangler logs for this issue.`,
	);
	return lines.join('\n\n');
}

export interface CommentClient {
	listComments(ref: IssueRef): Promise<Array<{ body?: string | null }>>;
	createComment(ref: IssueRef, body: string): Promise<void>;
}

/**
 * Post the blocker comment unless a comment carrying the same marker already
 * exists (the settlement path is at-least-once; a redelivery or a second
 * isolate must not double-post). Listing failures fail open — posting twice
 * beats staying silent.
 */
export async function postBlockerCommentOnce(
	client: CommentClient,
	ref: IssueRef,
	markerKey: string,
	body: string,
): Promise<{ posted: boolean; deduped: boolean }> {
	const marker = failsafeMarker(markerKey);
	try {
		const existing = await client.listComments(ref);
		if (existing.some((comment) => comment.body?.includes(marker))) {
			return { posted: false, deduped: true };
		}
	} catch {
		// Fall through: dedupe is best-effort.
	}
	await client.createComment(ref, `${marker}\n${body}`);
	return { posted: true, deduped: false };
}

/** The settlement observation fields the failsafe reads; structural to stay framework-independent. */
export interface SettlementEvent {
	type: string;
	agentName?: string;
	instanceId?: string;
	submissionId?: string;
	outcome?: string;
	error?: { type?: string; name?: string; message?: string };
}

export interface SettlementDeps {
	codingAgentName: string;
	parseInstanceId(id: string): IssueRef;
	workBranch(issueNumber: number): string;
	breakerStatus(ref: IssueRef): BreakerStatus | undefined;
	checkpoint(ref: IssueRef): Promise<CheckpointOutcome>;
	findOpenPrUrl(ref: IssueRef): Promise<string | undefined>;
	comments: CommentClient;
	log(level: 'info' | 'error', message: string, attributes: Record<string, unknown>): void;
}

/**
 * Terminal fail-closed path: a Coding submission settled `failed` (budget or
 * retries exhausted), so no model turn will ever report the outcome. Preserve
 * whatever the sandbox holds and put a blocker comment on the issue.
 * `aborted` settlements are deliberate cancellations (label removed) and stay
 * silent; `completed` ones were already enforced by the finish seam.
 */
export async function handleCodingSettlement(
	event: SettlementEvent,
	deps: SettlementDeps,
): Promise<void> {
	if (event.type !== 'submission_settled') return;
	if (event.agentName !== deps.codingAgentName) return;
	if (event.outcome !== 'failed') return;
	if (!event.instanceId) return;

	let ref: IssueRef;
	try {
		ref = deps.parseInstanceId(event.instanceId);
	} catch {
		// Not an issue-keyed instance (e.g. a manual run) — nothing to report to.
		deps.log('error', 'coding failsafe: unparseable instance id', {
			instanceId: event.instanceId,
		});
		return;
	}

	let checkpoint: CheckpointOutcome;
	try {
		checkpoint = await deps.checkpoint(ref);
	} catch (error) {
		checkpoint = {
			// attempted stays true: a throw means the attempt blew up, and the
			// comment must say the work could not be preserved — not pretend no
			// workspace existed.
			attempted: true,
			committed: false,
			pushed: false,
			branch: deps.workBranch(ref.issueNumber),
			detail: `checkpoint threw: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const prUrl = await deps.findOpenPrUrl(ref).catch(() => undefined);
	const body = buildBlockerComment({
		ref,
		reason: 'run-failed',
		branch: deps.workBranch(ref.issueNumber),
		breaker: deps.breakerStatus(ref),
		checkpoint,
		errorType: event.error?.type ?? event.error?.name,
		...(prUrl ? { prUrl } : {}),
	});
	try {
		const result = await postBlockerCommentOnce(
			deps.comments,
			ref,
			`settled:${event.submissionId ?? 'unknown'}`,
			body,
		);
		deps.log('info', 'coding failsafe: settlement handled', {
			issueNumber: ref.issueNumber,
			submissionId: event.submissionId,
			posted: result.posted,
			deduped: result.deduped,
			checkpointPushed: checkpoint.pushed,
		});
	} catch (error) {
		deps.log('error', 'coding failsafe: blocker comment failed', {
			issueNumber: ref.issueNumber,
			submissionId: event.submissionId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
