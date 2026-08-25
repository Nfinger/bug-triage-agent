import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { normalizeDomain } from '../prospecting/crm.ts';
import { matchesGeography } from '../prospecting/scoring.ts';
import type { SourcingCategory } from '../prospecting/sourcing-categories.ts';
import { canonicalUrl } from '../prospecting/web.ts';
import type { RunContext } from '../prospecting/run-context.ts';
import { slackPoster, type SummaryPoster } from './slack-summary.ts';

// The sourcing run's writes. Everything that makes a created company
// trustworthy is enforced here, in code: the per-run cap, the fetched-site
// evidence, the geography and industry gates, dedupe against the portal, and
// the agent-sourced provenance markers. The model proposes; this disposes.

type ToolError = { ok: false; error: string };
type CreateCompanyOutput = ToolError | { ok: true; companyId: string; domain: string; created: number; remaining: number };
type PostOutput = { ok: true; channel: string; ts: string } | ToolError;

/** Per-run creation state, owned by tool code — never by the model. */
export interface SourcingState {
	focus: SourcingCategory;
	max: number;
	created: { companyId: string; name: string; domain: string; industry: string }[];
}

function errorOutput(error: unknown): ToolError {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function createCompany(context: RunContext, state: SourcingState) {
	return defineTool({
		name: 'create_company',
		description:
			'Add one net-new company to HubSpot from this run\'s research. Requires: the company\'s own website ' +
			'fetched this run (websiteUrl), a domain not already in HubSpot, an in-territory state, and an ICP ' +
			'industry. Capped per run. The company is marked agent-sourced and a note records the sources.',
		input: v.object({
			name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
			domain: v.pipe(v.string(), v.trim(), v.minLength(3), v.maxLength(200)),
			state: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(40)),
			industry: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(80)),
			websiteUrl: v.pipe(v.string(), v.url()),
			sourceUrls: v.optional(v.array(v.pipe(v.string(), v.url())), []),
		}),
		async run({ data, log }): Promise<{ output: CreateCompanyOutput }> {
			try {
				if (state.created.length >= state.max) {
					return { output: { ok: false, error: `Creation cap reached (${state.max} this run); record remaining finds in the summary instead` } };
				}
				const domain = normalizeDomain(data.domain);
				if (!domain) return { output: { ok: false, error: `"${data.domain}" is not a usable domain` } };
				if (context.knowledge.icp.excludedDomains.includes(domain)) {
					return { output: { ok: false, error: `Domain "${domain}" is excluded by the ICP` } };
				}
				if (!context.fetchedUrls.has(canonicalUrl(data.websiteUrl))) {
					return { output: { ok: false, error: `websiteUrl ${data.websiteUrl} was not fetched this run; fetch the company's own site before creating it` } };
				}
				const siteHost = normalizeDomain(new URL(data.websiteUrl).hostname);
				if (!siteHost || (siteHost !== domain && !siteHost.endsWith(`.${domain}`))) {
					return { output: { ok: false, error: `websiteUrl host "${siteHost}" is not the company's domain "${domain}"` } };
				}
				const geographies = context.knowledge.icp.geographies;
				if (geographies.length > 0 && !matchesGeography(geographies, data.state, data.state)) {
					return { output: { ok: false, error: `State "${data.state}" is outside the ICP territory (${geographies.join(', ')}); do not create out-of-territory companies` } };
				}
				if (!context.knowledge.icp.industries.some((industry) => industry.toLowerCase() === data.industry.toLowerCase())) {
					return { output: { ok: false, error: `Industry "${data.industry}" is not in the ICP industry list` } };
				}
				const existing = await context.crm.findCompanyByDomain(domain);
				if (!existing.ok) return { output: { ok: false, error: existing.error } };
				if (existing.data) {
					return { output: { ok: false, error: `A company with domain ${domain} already exists in HubSpot (${existing.data.properties.name ?? existing.data.id}); skip it` } };
				}
				const runDay = new Date(`${context.runDate}T00:00:00Z`);
				const created = await context.crm.createCompany({
					name: data.name,
					domain,
					state: data.state,
					industry: data.industry.toUpperCase(),
					agent_sourced: 'true',
					agent_sourced_run: String(runDay.getTime()),
				});
				if (!created.ok) return { output: { ok: false, error: created.error } };
				const note = await context.crm.createNote(
					{ companyId: created.data.id },
					[
						`<strong>Sourced by prospecting agent — ${context.runDate}</strong>`,
						`Category: ${state.focus.key}`,
						``,
						`Sources:`,
						...[data.websiteUrl, ...data.sourceUrls].map((url) => `• ${url}`),
					].join('<br>'),
					context.now(),
				);
				if (!note.ok) log.warn('sourcing note not created', { companyId: created.data.id, error: note.error });
				state.created.push({ companyId: created.data.id, name: data.name, domain, industry: data.industry.toUpperCase() });
				log.info('company sourced', { companyId: created.data.id, domain, category: state.focus.key });
				return { output: { ok: true, companyId: created.data.id, domain, created: state.created.length, remaining: state.max - state.created.length } };
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}

const HUBSPOT_COMPANY_URL = (id: string) => `https://app.hubspot.com/contacts/_/company/${id}`;

export function postSourcingSummary(context: RunContext, state: SourcingState, poster: SummaryPoster = slackPoster()) {
	return defineTool({
		name: 'post_sourcing_summary',
		description:
			'Post this sourcing run\'s summary to the team Slack channel: companies created (listed from the ' +
			'run\'s own records) plus candidates you skipped and why. Call exactly once, at the very end.',
		input: v.object({
			skipped: v.array(v.object({ name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)), reason: v.pipe(v.string(), v.minLength(1), v.maxLength(200)) })),
			notes: v.optional(v.pipe(v.string(), v.maxLength(1_000))),
		}),
		async run({ data, log }): Promise<{ output: PostOutput }> {
			const lines = [
				`*Sourcing run ${context.runDate}* — focus: ${state.focus.key} · ${state.created.length} of up to ${state.max} companies created`,
				...state.created.map((company) => `🆕 <${HUBSPOT_COMPANY_URL(company.companyId)}|${company.name}> (${company.domain}, ${company.industry})`),
				...data.skipped.map((skip) => `⏭️ ${skip.name} — ${skip.reason}`),
				...(state.created.length === 0 && data.skipped.length === 0 ? ['No viable candidates found this run.'] : []),
				...(data.notes ? [``, data.notes] : []),
			];
			const result = await poster.post(lines.join('\n'));
			if (!result.ok) log.warn('sourcing summary not posted to Slack', { error: result.error });
			else log.info('sourcing summary posted', { channel: result.channel, ts: result.ts });
			return { output: result };
		},
	});
}

/** Shared batch fencing note: research tools charge everything to this key. */
export const SOURCING_RESEARCH_KEY = 'sourcing-run';

export function sourcingBatchEntry() {
	return { companyId: SOURCING_RESEARCH_KEY, name: 'Sourcing research', score: 0, signals: [] as { signal: string; weight: number; detail: string }[] };
}
