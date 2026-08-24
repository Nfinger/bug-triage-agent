// Cloudflare deployment module. The Sandbox Durable Object backs the coding
// agent's per-issue containers (see wrangler.jsonc bindings), and the Cron
// Triggers declared there arrive here as scheduled() fires.
export { Sandbox } from '@cloudflare/sandbox';

import { dispatchArchitectureReview } from './schedules/architecture-review.ts';
import { dispatchProspecting } from './schedules/prospecting.ts';

// Cron expressions exactly as declared in wrangler.jsonc "triggers.crons" —
// Cloudflare hands the matching expression back on each fire, which is how a
// Worker with several triggers tells them apart.
export const CRON = {
	architectureReview: '0 9 * * 5',
	prospecting: '0 13 * * 1-5',
} as const;

// Non-HTTP Worker handlers only — HTTP belongs to app.ts.
export default {
	async scheduled(controller: { cron: string; scheduledTime: number }): Promise<void> {
		const firedAt = new Date(controller.scheduledTime);
		switch (controller.cron) {
			case CRON.architectureReview:
				// One weekly fire (Friday, UTC) → one architecture-review run. The
				// agent is dispatch-only: no route is mounted for it.
				await dispatchArchitectureReview(firedAt);
				return;
			case CRON.prospecting:
				// One weekday fire (13:00 UTC) → one prospecting run, likewise
				// dispatch-only.
				await dispatchProspecting(firedAt);
				return;
			default:
				console.warn(`[scheduled] unrecognised cron "${controller.cron}"; nothing dispatched`);
		}
	},
};
