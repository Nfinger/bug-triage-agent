import { batchSize, cooldownDays, signalLookbackDays } from './config.ts';
import { type CompanyRecord, Crm, type CrmObject } from './crm.ts';
import type { Knowledge } from './knowledge.ts';
import type { BatchEntry } from './run-context.ts';
import { rankCompanies, type CompanySnapshot, type ExclusionReason } from './scoring.ts';

// How many pages of recently-modified companies one run will consider. At
// 100 per page this bounds the candidate pool, and the HubSpot calls, per run.
const MAX_SEARCH_PAGES = 5;

export interface Selection {
	selected: BatchEntry[];
	considered: number;
	excluded: Record<ExclusionReason | 'no-signal', number>;
}

/**
 * The dispatcher's half of selection: pull the candidate pool from HubSpot,
 * attach deals, and hand the pure ranker the snapshots. Throws on a HubSpot
 * failure — a run that cannot see the CRM must not start.
 */
export async function selectBatch(knowledge: Knowledge, now: Date, crm = new Crm()): Promise<Selection> {
	const lookbackDays = signalLookbackDays();
	const since = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
	const companies = await crm.searchActiveCompanies(since, MAX_SEARCH_PAGES);
	if (!companies.ok) throw new Error(`Could not search HubSpot companies: ${companies.error}`);

	const dealLinks = await crm.getAssociations(
		companies.data.map((company) => company.id),
		'deals',
	);
	if (!dealLinks.ok) throw new Error(`Could not read company→deal associations: ${dealLinks.error}`);
	const dealIds = [...new Set([...dealLinks.data.values()].flat())];
	const deals = await crm.getDeals(dealIds);
	if (!deals.ok) throw new Error(`Could not read deals: ${deals.error}`);
	const dealById = new Map(deals.data.map((deal) => [deal.id, deal]));

	const snapshots: CompanySnapshot[] = companies.data.map((company) => {
		const ids = dealLinks.data.get(company.id) ?? [];
		const record: CompanyRecord = { ...company, dealIds: ids };
		return { company: record, deals: ids.map((id) => dealById.get(id)).filter((deal): deal is CrmObject => Boolean(deal)) };
	});

	const ranked = rankCompanies(
		snapshots,
		{ icp: knowledge.icp, lookbackDays, cooldownDays: cooldownDays(), now },
		batchSize(),
	);
	return { selected: ranked.selected, considered: snapshots.length, excluded: ranked.excluded };
}
