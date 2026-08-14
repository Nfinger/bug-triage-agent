// Cloudflare deployment module. The Sandbox Durable Object backs the coding
// agent's per-issue containers (see wrangler.jsonc bindings), and the Cron
// Trigger declared there arrives here as a scheduled() fire.
export { Sandbox } from '@cloudflare/sandbox';

import { dispatchArchitectureReview } from './schedules/architecture-review.ts';

// Non-HTTP Worker handlers only — HTTP belongs to app.ts.
export default {
	async scheduled(controller: { cron: string; scheduledTime: number }): Promise<void> {
		// One weekly fire (Friday, UTC) → one architecture-review run. The
		// ArchitectureReview agent is dispatch-only: no route is mounted for it,
		// so this is the only way a review starts.
		await dispatchArchitectureReview(new Date(controller.scheduledTime));
	},
};
