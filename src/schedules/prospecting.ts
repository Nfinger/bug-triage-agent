import { dispatch } from '@flue/runtime';
import { Prospecting } from '../agents/prospecting.ts';
import { loadKnowledge } from '../prospecting/business-docs.ts';
import { assertProspectingConfig, prospectingEnabled } from '../prospecting/config.ts';
import { assertCustomProperties, Crm } from '../prospecting/crm.ts';
import { selectBatch } from '../prospecting/select-batch.ts';
import { preRunSummary, slackPoster } from '../tools/slack-summary.ts';

// The daily prospecting run's delivery half. The trigger is a Cloudflare Cron
// Trigger declared in wrangler.jsonc and handled in src/cloudflare.ts; this
// module turns a fire into one dispatched run: validate configuration, select
// the batch in code, hand it to the agent. Cloudflare evaluates cron in UTC,
// so the run date is UTC too.

export function runDateOf(firedAt: Date): string {
	return firedAt.toISOString().slice(0, 10);
}

/**
 * Dispatch one run. Exported so a run can also be started by hand
 * (scripts/run-prospecting.mjs); the date-keyed conversation ID and
 * idempotency key mean a repeat for the same day is a no-op, which also
 * covers Cloudflare's at-least-once scheduled delivery.
 */
export async function dispatchProspecting(firedAt: Date): Promise<void> {
	if (!prospectingEnabled()) {
		console.log('[prospecting] skipped (PROSPECTING_ENABLED=false)');
		return;
	}
	const runDate = runDateOf(firedAt);
	const conversationId = `prospecting-${runDate}`;
	const poster = slackPoster();

	let selection: Awaited<ReturnType<typeof selectBatch>>;
	try {
		assertProspectingConfig();
		const knowledge = loadKnowledge();
		const crm = new Crm();
		await assertCustomProperties(crm);
		selection = await selectBatch(knowledge, firedAt, crm);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[prospecting] ${runDate} could not start: ${message}`);
		await poster.post(preRunSummary(runDate, `could not start: ${message}`));
		throw error;
	}

	const exclusions = Object.entries(selection.excluded)
		.filter(([, count]) => count > 0)
		.map(([reason, count]) => `${reason} ${count}`)
		.join(', ');
	if (selection.selected.length === 0) {
		console.log(`[prospecting] ${runDate}: 0 of ${selection.considered} companies selected (${exclusions || 'none excluded'})`);
		await poster.post(preRunSummary(runDate, `0 accounts selected from ${selection.considered} considered${exclusions ? ` (${exclusions})` : ''}`));
		return;
	}

	try {
		await dispatch(Prospecting, {
			id: conversationId,
			idempotencyKey: conversationId,
			// Recorded once when this fire creates the conversation; ignored after.
			initialData: {
				runDate,
				scheduledAt: firedAt.toISOString(),
				batch: selection.selected,
			},
			message: {
				kind: 'signal',
				type: 'schedule',
				body: `Run today's prospecting for ${selection.selected.length} selected ${selection.selected.length === 1 ? 'company' : 'companies'}: research each, pick the right contacts, send personalized outreach, record every outcome in HubSpot, then post the summary.`,
				attributes: { runDate, scheduledAt: firedAt.toISOString(), selected: String(selection.selected.length) },
			},
		});
	} catch (error) {
		// A byte-identical redelivery dedupes silently, but a second fire on the
		// same day carries a new scheduledAt, so the shared idempotency key is
		// rejected as "a different submission". That still means this runDate is
		// already handled — absorb it instead of letting scheduled() throw.
		if (error instanceof Error && /idempotency/i.test(error.message)) {
			console.log(`[prospecting] duplicate fire for ${runDate} ignored`);
			return;
		}
		throw error;
	}

	console.log(`[prospecting] dispatched ${conversationId} (${selection.selected.length} of ${selection.considered} companies; excluded: ${exclusions || 'none'})`);
}
