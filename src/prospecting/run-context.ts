import type { Crm } from './crm.ts';
import type { Knowledge } from './knowledge.ts';
import { OutreachLedger } from './ledger.ts';
import { ResearchBudget } from './research-budget.ts';

/** One selected company as handed to the agent. */
export interface BatchEntry {
	companyId: string;
	name: string;
	domain?: string;
	score: number;
	signals: { signal: string; weight: number; detail: string }[];
}

/**
 * Everything the tools share across one run: what the dispatcher selected,
 * the business knowledge, and the per-run state (ledger, research budget,
 * URLs fetched so far) that the guardrails are enforced against. Built once
 * in the agent render; never from model input.
 */
export interface RunContext {
	runDate: string;
	now: () => Date;
	batch: BatchEntry[];
	knowledge: Knowledge;
	crm: Crm;
	ledger: OutreachLedger;
	research: ResearchBudget;
	/** URLs successfully fetched this run, accepted as outreach evidence. */
	fetchedUrls: Set<string>;
	/**
	 * Emails the provider verified this run (lowercased email → record).
	 * Written only by the lookup tool; create_contact accepts these as its
	 * second evidence path.
	 */
	verifiedEmails: Map<string, { firstName: string | null; lastName: string | null; title: string | null; score: number; source: string }>;
	/**
	 * Persist the run's mutable state (fetchedUrls, verifiedEmails, budget,
	 * ledger) via the agent's usePersistentState. The agent re-renders on
	 * every model call, so anything not saved here is forgotten between
	 * turns. Tools MUST call this after mutating shared state.
	 */
	save?: () => void;
	settings: {
		outreachEnabled: boolean;
		dailyCap: number;
		cooldownDays: number;
		contactsPerCompany: number;
		senderEmail: string;
		templateId: () => number;
	};
}

export function inBatch(context: RunContext, companyId: string): BatchEntry | undefined {
	return context.batch.find((entry) => entry.companyId === companyId);
}
