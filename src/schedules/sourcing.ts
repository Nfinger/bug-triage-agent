import { dispatch } from '@flue/runtime';
import { Sourcing } from '../agents/sourcing.ts';
import { sourcingEnabled, sourcingMaxCompanies } from '../prospecting/config.ts';
import { Crm, SOURCING_PROPERTY_DEFINITIONS } from '../prospecting/crm.ts';
import { focusCategoryFor } from '../prospecting/sourcing-categories.ts';
import { slackPoster } from '../tools/slack-summary.ts';
import { runDateOf } from './prospecting.ts';

// The sourcing run's delivery half: cron fires arrive via src/cloudflare.ts
// an hour before the prospecting run, so the morning's finds are freshly
// modified when selection queries HubSpot. The focus category is computed
// here, in code — coverage across the ICP is the schedule's job.

export type SourcingDispatchResult = { dispatched: boolean; focus: string };

export async function dispatchSourcing(firedAt: Date, options: { runId?: string } = {}): Promise<SourcingDispatchResult> {
	const runDate = runDateOf(firedAt);
	const focus = focusCategoryFor(runDate);
	if (!sourcingEnabled()) {
		console.log('[sourcing] skipped (SOURCING_ENABLED=false)');
		return { dispatched: false, focus: focus.key };
	}
	const conversationId = options.runId ?? `sourcing-${runDate}`;
	const poster = slackPoster();

	try {
		sourcingMaxCompanies();
		const crm = new Crm();
		// A fresh portal needs no manual setup: the properties the run writes
		// are created idempotently before the first company is.
		for (const definition of SOURCING_PROPERTY_DEFINITIONS) {
			const ensured = await crm.ensureProperty('companies', definition);
			if (!ensured.ok) throw new Error(`Could not ensure company property ${definition.name}: ${ensured.error}`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[sourcing] ${runDate} could not start: ${message}`);
		await poster.post(`*Sourcing run ${runDate}* — could not start: ${message}`);
		throw error;
	}

	try {
		await dispatch(Sourcing, {
			id: conversationId,
			idempotencyKey: conversationId,
			initialData: {
				runDate,
				scheduledAt: firedAt.toISOString(),
				focus: { key: focus.key, description: focus.description, industries: focus.industries },
			},
			message: {
				kind: 'signal',
				type: 'schedule',
				body: `Run today's company sourcing with focus "${focus.key}": research the category, verify candidates on their own sites, create the qualified ones in HubSpot, then post the summary.`,
				attributes: { runDate, scheduledAt: firedAt.toISOString(), focus: focus.key },
			},
		});
	} catch (error) {
		// Same absorption as prospecting: a second fire for the day carries a
		// new scheduledAt, so the shared idempotency key rejects it.
		if (error instanceof Error && /idempotency/i.test(error.message)) {
			console.log(`[sourcing] duplicate fire for ${runDate} ignored`);
			return { dispatched: false, focus: focus.key };
		}
		throw error;
	}

	console.log(`[sourcing] dispatched ${conversationId} (focus ${focus.key})`);
	return { dispatched: true, focus: focus.key };
}
