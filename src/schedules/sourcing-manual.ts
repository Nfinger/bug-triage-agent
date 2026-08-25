import { Hono } from 'hono';
import { manualRunToken } from '../prospecting/config.ts';
import { tokenMatches } from './prospecting-manual.ts';
import { runDateOf } from './prospecting.ts';
import { dispatchSourcing } from './sourcing.ts';

// Operator-only one-off sourcing runs, guarded by the same bearer token as
// the prospecting manual endpoint. Fail-closed: 404 without the secret.

export function route() {
	const app = new Hono();

	app.post('/run', async (context) => {
		const expected = manualRunToken();
		if (!expected) return context.notFound();
		if (!(await tokenMatches(context.req.header('authorization'), expected))) {
			return context.json({ ok: false, error: 'unauthorized' }, 401);
		}
		const firedAt = new Date();
		const runId = `sourcing-${runDateOf(firedAt)}-manual-${firedAt.getTime().toString(36)}`;
		const result = await dispatchSourcing(firedAt, { runId });
		console.log(`[sourcing] manual run ${runId}: dispatched=${result.dispatched} focus=${result.focus}`);
		return context.json({ ok: true, runId, ...result });
	});

	return app;
}
