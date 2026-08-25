import { isTrue, normalizeDomain, timestampMs, type CompanyRecord, type CrmObject } from './crm.ts';
import type { Icp } from './knowledge.ts';
import type { BatchEntry } from './run-context.ts';

/**
 * Buying-signal scoring. Deterministic and model-free: the same company
 * snapshot always yields the same score, and the run summary can explain
 * every selection as a list of (signal, weight). Weights are the proposed
 * defaults from the design; tune them here, in one place, from what
 * draft-mode runs show.
 */

export interface Weights {
	formSubmission: number;
	websiteVisit: number;
	openDeal: number;
	stageAdvance: number;
	inboundEngagement: number;
	/**
	 * Recently created by the sourcing agent. The floor of the behavioural
	 * weights on purpose: it makes a sourced company selectable at all (fit
	 * alone is excluded as no-signal) without ever outranking a genuinely
	 * warm account.
	 */
	sourcedFresh: number;
	/** Maximum ICP-fit contribution; industry, size, and geography each earn a share. */
	icpFit: number;
}

export const DEFAULT_WEIGHTS: Weights = {
	formSubmission: 40,
	websiteVisit: 15,
	openDeal: 25,
	stageAdvance: 20,
	inboundEngagement: 20,
	sourcedFresh: 15,
	icpFit: 30,
};

export interface CompanySnapshot {
	company: CompanyRecord;
	deals: CrmObject[];
}

export interface ScoringOptions {
	icp: Icp;
	weights?: Weights;
	lookbackDays: number;
	cooldownDays: number;
	now: Date;
}

export type ExclusionReason = 'do-not-prospect' | 'customer' | 'closed-won-deal' | 'cooldown' | 'no-domain';

export interface Scored {
	companyId: string;
	score: number;
	signals: BatchEntry['signals'];
	excluded?: ExclusionReason;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Small-business CRM records fill `state` far more reliably than `country`,
// and the ICP may target a state ("Maine"). A geography entry matches the
// company's state (by name or two-letter code) or its country.
const US_STATES: Record<string, string> = {
	al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado',
	ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho',
	il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana',
	me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota',
	ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada',
	nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina',
	nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
	ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas',
	ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia',
	wi: 'wisconsin', wy: 'wyoming', dc: 'district of columbia',
};

function canonical(value: string): string {
	const lower = value.trim().toLowerCase();
	return US_STATES[lower] ?? lower;
}

/** Does any ICP geography match the company's state or country? */
export function matchesGeography(geographies: string[], state: string | null | undefined, country: string | null | undefined): boolean {
	const place = new Set([state, country].filter((value): value is string => Boolean(value)).map(canonical));
	return geographies.some((geo) => place.has(canonical(geo)));
}

function within(ms: number | undefined, now: Date, days: number): boolean {
	return ms !== undefined && now.getTime() - ms >= 0 && now.getTime() - ms < days * DAY_MS;
}

function daysAgo(ms: number, now: Date): string {
	return `${Math.max(0, Math.floor((now.getTime() - ms) / DAY_MS))}d ago`;
}

/** Why a company is off the table before scoring, or undefined when it is eligible. */
export function exclusionReason(snapshot: CompanySnapshot, options: ScoringOptions): ExclusionReason | undefined {
	const p = snapshot.company.properties;
	if (isTrue(p.do_not_prospect)) return 'do-not-prospect';
	if (!normalizeDomain(p.domain)) return 'no-domain';
	if (p.lifecyclestage === 'customer' || p.lifecyclestage === 'evangelist' || p.hs_date_entered_customer) return 'customer';
	if (snapshot.deals.some((deal) => isTrue(deal.properties.hs_is_closed_won))) return 'closed-won-deal';
	const lastProspected = timestampMs(p.last_prospected_at);
	if (within(lastProspected, options.now, options.cooldownDays)) return 'cooldown';
	return undefined;
}

export function scoreCompany(snapshot: CompanySnapshot, options: ScoringOptions): Scored {
	const weights = options.weights ?? DEFAULT_WEIGHTS;
	const p = snapshot.company.properties;
	const signals: BatchEntry['signals'] = [];
	const excluded = exclusionReason(snapshot, options);
	if (excluded) return { companyId: snapshot.company.id, score: 0, signals, excluded };

	const conversion = timestampMs(p.recent_conversion_date);
	if (within(conversion, options.now, options.lookbackDays)) {
		signals.push({
			signal: 'form-submission',
			weight: weights.formSubmission,
			detail: `${p.recent_conversion_event_name ?? 'conversion'} ${daysAgo(conversion!, options.now)}`,
		});
	}
	const visit = timestampMs(p.hs_analytics_last_visit_timestamp);
	if (within(visit, options.now, options.lookbackDays)) {
		signals.push({ signal: 'website-visit', weight: weights.websiteVisit, detail: `last visit ${daysAgo(visit!, options.now)}` });
	}
	const openDeals = snapshot.deals.filter((deal) => !isTrue(deal.properties.hs_is_closed));
	const activeOpenDeal = openDeals.find((deal) =>
		within(timestampMs(deal.properties.hs_lastmodifieddate) ?? timestampMs(deal.properties.createdate), options.now, options.lookbackDays),
	);
	if (activeOpenDeal) {
		signals.push({
			signal: 'open-deal',
			weight: weights.openDeal,
			detail: `"${activeOpenDeal.properties.dealname ?? activeOpenDeal.id}" in stage ${activeOpenDeal.properties.dealstage ?? '?'}`,
		});
	}
	const stageEntries = [
		['marketingqualifiedlead', p.hs_date_entered_marketingqualifiedlead],
		['salesqualifiedlead', p.hs_date_entered_salesqualifiedlead],
		['opportunity', p.hs_date_entered_opportunity],
	] as const;
	const advanced = stageEntries
		.map(([stage, value]) => ({ stage, ms: timestampMs(value) }))
		.filter((entry) => within(entry.ms, options.now, options.lookbackDays))
		.sort((a, b) => b.ms! - a.ms!)[0];
	if (advanced) {
		signals.push({ signal: 'stage-advance', weight: weights.stageAdvance, detail: `entered ${advanced.stage} ${daysAgo(advanced.ms!, options.now)}` });
	}
	const inbound = Math.max(timestampMs(p.notes_last_contacted) ?? 0, timestampMs(p.hs_last_sales_activity_timestamp) ?? 0) || undefined;
	if (within(inbound, options.now, options.lookbackDays)) {
		signals.push({ signal: 'recent-engagement', weight: weights.inboundEngagement, detail: `last activity ${daysAgo(inbound!, options.now)}` });
	}
	const sourced = isTrue(p.agent_sourced) ? timestampMs(p.agent_sourced_run) : undefined;
	if (within(sourced, options.now, options.lookbackDays)) {
		signals.push({ signal: 'sourced-fresh', weight: weights.sourcedFresh, detail: `sourced by agent ${daysAgo(sourced!, options.now)}` });
	}

	// ICP fit: three equal shares of the icpFit weight.
	const share = weights.icpFit / 3;
	const fit: string[] = [];
	let fitScore = 0;
	if (p.industry && options.icp.industries.some((industry) => industry.toLowerCase() === p.industry!.toLowerCase())) {
		fitScore += share;
		fit.push(`industry ${p.industry}`);
	}
	const employees = Number(p.numberofemployees);
	if (Number.isFinite(employees) && employees > 0 && options.icp.sizeRanges.some((range) => employees >= range.min && employees <= range.max)) {
		fitScore += share;
		fit.push(`${employees} employees`);
	}
	if (options.icp.geographies.length === 0) {
		fitScore += share;
	} else if (matchesGeography(options.icp.geographies, p.state, p.country)) {
		fitScore += share;
		fit.push(`location ${[p.state, p.country].filter(Boolean).join(', ')}`);
	}
	if (fitScore > 0) {
		signals.push({ signal: 'icp-fit', weight: Math.round(fitScore), detail: fit.join(', ') || 'no geography restriction' });
	}

	return {
		companyId: snapshot.company.id,
		score: signals.reduce((sum, signal) => sum + signal.weight, 0),
		signals,
	};
}

/**
 * Rank eligible companies by score. Only companies with at least one
 * behavioural signal (anything beyond ICP fit) qualify: fit alone is a list,
 * not a buying signal.
 */
export function rankCompanies(snapshots: CompanySnapshot[], options: ScoringOptions, limit: number): { selected: BatchEntry[]; excluded: Record<ExclusionReason | 'no-signal', number> } {
	const excluded: Record<ExclusionReason | 'no-signal', number> = {
		'do-not-prospect': 0,
		customer: 0,
		'closed-won-deal': 0,
		cooldown: 0,
		'no-domain': 0,
		'no-signal': 0,
	};
	const scored: { snapshot: CompanySnapshot; scored: Scored }[] = [];
	for (const snapshot of snapshots) {
		const result = scoreCompany(snapshot, options);
		if (result.excluded) {
			excluded[result.excluded]++;
			continue;
		}
		if (!result.signals.some((signal) => signal.signal !== 'icp-fit')) {
			excluded['no-signal']++;
			continue;
		}
		scored.push({ snapshot, scored: result });
	}
	scored.sort((a, b) => b.scored.score - a.scored.score || a.snapshot.company.id.localeCompare(b.snapshot.company.id));
	return {
		selected: scored.slice(0, limit).map(({ snapshot, scored: result }) => ({
			companyId: snapshot.company.id,
			name: snapshot.company.properties.name ?? snapshot.company.properties.domain ?? snapshot.company.id,
			domain: normalizeDomain(snapshot.company.properties.domain),
			score: result.score,
			signals: result.signals,
		})),
		excluded,
	};
}
