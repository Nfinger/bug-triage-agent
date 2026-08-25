import { Hono } from 'hono';
import { manualRunToken } from '../prospecting/config.ts';
import { Crm } from '../prospecting/crm.ts';
import { dispatchProspecting, runDateOf } from './prospecting.ts';

// Operator-only entry point for one-off prospecting runs. The cron path in
// src/cloudflare.ts stays the production trigger; this exists so a human can
// retry a company (optionally clearing its prospecting cooldown) without
// waiting a day or holding the prod env vars locally. Fail-closed: without
// the PROSPECTING_MANUAL_TOKEN secret the route answers 404.

const MAX_RESET_DOMAINS = 10;

type ResetResult = { domain: string; companyId: string | null; ok: boolean; error?: string };

/** Digest comparison so a wrong token costs the same time as a near-miss. */
export async function tokenMatches(header: string | undefined, expected: string): Promise<boolean> {
	const presented = header?.replace(/^Bearer\s+/i, '') ?? '';
	const encoder = new TextEncoder();
	const [a, b] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(presented)),
		crypto.subtle.digest('SHA-256', encoder.encode(expected)),
	]);
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	let diff = 0;
	for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
	return diff === 0;
}

export function route() {
	const app = new Hono();

	app.post('/run', async (context) => {
		const expected = manualRunToken();
		if (!expected) return context.notFound();
		if (!(await tokenMatches(context.req.header('authorization'), expected))) {
			return context.json({ ok: false, error: 'unauthorized' }, 401);
		}

		const body: unknown = await context.req.json().catch(() => ({}));
		const requested = (body as { resetDomains?: unknown })?.resetDomains;
		const domains = Array.isArray(requested) ? requested.slice(0, MAX_RESET_DOMAINS).map(String) : [];

		const crm = new Crm();
		const reset: ResetResult[] = [];
		for (const domain of domains) {
			const found = await crm.findCompanyByDomain(domain);
			if (!found.ok) {
				reset.push({ domain, companyId: null, ok: false, error: found.error });
				continue;
			}
			if (!found.data) {
				reset.push({ domain, companyId: null, ok: false, error: 'no company with this domain' });
				continue;
			}
			const cleared = await crm.clearProspected(found.data.id);
			reset.push({ domain, companyId: found.data.id, ok: cleared.ok, ...(cleared.ok ? {} : { error: cleared.error }) });
		}

		const firedAt = new Date();
		const runId = `prospecting-${runDateOf(firedAt)}-manual-${firedAt.getTime().toString(36)}`;
		const result = await dispatchProspecting(firedAt, { runId });
		console.log(`[prospecting] manual run ${runId}: dispatched=${result.dispatched} selected=${result.selected}/${result.considered}`);
		return context.json({ ok: true, runId, ...result, reset });
	});

	return app;
}
