import { dispatch } from '@flue/runtime';
import { ArchitectureReview } from '../agents/architecture-review.ts';
import { reviewEnabled } from '../review/config.ts';
import { runDateIn, selectFocusArea } from '../review/focus-areas.ts';

// The weekly architecture review's delivery half. The trigger is a Cloudflare
// Cron Trigger declared in wrangler.jsonc and handled in src/cloudflare.ts;
// this module turns a fire into one dispatched run. Cloudflare evaluates cron
// expressions in UTC, so the run's date and focus area are derived in UTC too.
const TIMEZONE = 'UTC';

/**
 * Dispatch one review run. Exported so a run can also be triggered by hand
 * (verification, backfilling a week); the date-keyed conversation ID and
 * idempotency key mean a repeat for the same day is a no-op, which also covers
 * Cloudflare's at-least-once scheduled delivery.
 */
export async function dispatchArchitectureReview(firedAt: Date): Promise<void> {
	if (!reviewEnabled()) {
		console.log('[architecture-review] skipped (ARCH_REVIEW_ENABLED=false)');
		return;
	}

	const focus = selectFocusArea(firedAt, TIMEZONE);
	const runDate = runDateIn(firedAt, TIMEZONE);
	const conversationId = `arch-review-${runDate}`;

	await dispatch(ArchitectureReview, {
		id: conversationId,
		idempotencyKey: conversationId,
		// Recorded once when this fire creates the conversation; ignored after.
		initialData: {
			focusAreaId: focus.id,
			focusAreaTitle: focus.title,
			focusAreaBrief: focus.brief,
			runDate,
			scheduledAt: firedAt.toISOString(),
		},
		message: {
			kind: 'signal',
			type: 'schedule',
			body: `Run this week's architecture review of ${focus.title}. Report improvements, hardening opportunities, and technical debt, then file the report as a GitHub issue.`,
			attributes: {
				focusArea: focus.id,
				runDate,
				scheduledAt: firedAt.toISOString(),
			},
		},
	});

	console.log(`[architecture-review] dispatched ${conversationId} (${focus.id})`);
}
