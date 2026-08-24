import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { slackBotToken, slackProspectingChannel } from '../prospecting/config.ts';
import type { RunContext } from '../prospecting/run-context.ts';

// End-of-run summary to Slack. Posting is best-effort: a Slack failure is
// logged and reported in the tool result, never thrown — the CRM already
// holds the authoritative record of what happened.

type PostOutput = { ok: true; channel: string; ts: string } | { ok: false; error: string };

const companyLineSchema = v.object({
	companyId: v.pipe(v.string(), v.minLength(1)),
	name: v.pipe(v.string(), v.minLength(1)),
	status: v.picklist(['sent', 'drafted', 'skipped', 'uncertain']),
	detail: v.pipe(v.string(), v.maxLength(400)),
	contacts: v.array(v.object({ email: v.string(), status: v.picklist(['sent', 'drafted', 'uncertain', 'skipped']) })),
});

const HUBSPOT_COMPANY_URL = (id: string) => `https://app.hubspot.com/contacts/_/company/${id}`;

export interface SummaryPoster {
	post(text: string): Promise<PostOutput>;
}

export function slackPoster(): SummaryPoster {
	return {
		async post(text) {
			// Plain fetch rather than @slack/web-api: the SDK binds Node http
			// internals that throw "Illegal invocation" under workerd, and its
			// default retry policy blocks for up to ~30 minutes. One attempt,
			// 10s deadline — the CRM already holds the authoritative record.
			try {
				const channel = slackProspectingChannel();
				const response = await fetch('https://slack.com/api/chat.postMessage', {
					method: 'POST',
					headers: { authorization: `Bearer ${slackBotToken()}`, 'content-type': 'application/json; charset=utf-8' },
					body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false }),
					signal: AbortSignal.timeout(10_000),
				});
				const result = (await response.json()) as { ok: boolean; error?: string; ts?: string };
				if (!result.ok || !result.ts) return { ok: false, error: result.error ?? `Slack returned ${response.status}` };
				return { ok: true, channel, ts: result.ts };
			} catch (error) {
				return { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		},
	};
}

/** Text of a summary for a run that dispatched no agent (disabled, empty batch, or failed selection). */
export function preRunSummary(runDate: string, detail: string): string {
	return `*Prospecting run ${runDate}* — ${detail}`;
}

export function postRunSummary(context: RunContext, poster: SummaryPoster = slackPoster()) {
	return defineTool({
		name: 'post_run_summary',
		description:
			'Post this run\'s summary to the team Slack channel: every selected company with what happened, ' +
			'contacts emailed or drafted, and skips with reasons. Call exactly once, at the very end, after ' +
			'record_company_outcome for every company.',
		input: v.object({
			companies: v.array(companyLineSchema),
			notes: v.optional(v.pipe(v.string(), v.maxLength(1_000))),
		}),
		async run({ data, log }): Promise<{ output: PostOutput }> {
			const ledger = context.ledger.summary();
			const icon = { sent: '✅', drafted: '📝', skipped: '⏭️', uncertain: '⚠️' } as const;
			const lines = [
				`*Prospecting run ${context.runDate}* — ${context.batch.length} selected · ${ledger.sent} sent · ${ledger.drafted} drafted · ${ledger.uncertain} uncertain${context.settings.outreachEnabled ? '' : ' · _sending disabled (OUTREACH_ENABLED=false)_'}`,
				...data.companies.map((company) => {
					const selected = context.batch.find((entry) => entry.companyId === company.companyId);
					const why = selected ? ` (score ${selected.score}: ${selected.signals.map((signal) => signal.signal).join(', ')})` : '';
					const contacts = company.contacts.length > 0 ? ` — ${company.contacts.map((contact) => `${contact.email} ${icon[contact.status]}`).join(', ')}` : '';
					return `${icon[company.status]} <${HUBSPOT_COMPANY_URL(company.companyId)}|${company.name}>${why}${contacts}\n    ${company.detail}`;
				}),
				...(data.notes ? [``, data.notes] : []),
			];
			// Companies the agent never reported on still show up, as skipped.
			const reported = new Set(data.companies.map((company) => company.companyId));
			for (const entry of context.batch) {
				if (!reported.has(entry.companyId)) {
					lines.push(`${icon.skipped} <${HUBSPOT_COMPANY_URL(entry.companyId)}|${entry.name}> — no outcome reported by the agent`);
				}
			}
			const result = await poster.post(lines.join('\n'));
			if (!result.ok) log.warn('run summary not posted to Slack', { error: result.error });
			else log.info('run summary posted', { channel: result.channel, ts: result.ts });
			return { output: result };
		},
	});
}
