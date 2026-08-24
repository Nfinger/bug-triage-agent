/**
 * Per-company research allowance for one run, so a single account cannot
 * absorb the whole run in page fetches or searches.
 */
export class ResearchBudget {
	private readonly used = new Map<string, { fetches: number; searches: number }>();
	private readonly limits: { fetches: number; searches: number };

	constructor(limits: { fetches: number; searches: number } = { fetches: 4, searches: 3 }) {
		this.limits = limits;
	}

	private entry(companyId: string) {
		let entry = this.used.get(companyId);
		if (!entry) {
			entry = { fetches: 0, searches: 0 };
			this.used.set(companyId, entry);
		}
		return entry;
	}

	/** Consume one unit; false (and nothing consumed) when the allowance is spent. */
	take(companyId: string, kind: 'fetches' | 'searches'): boolean {
		const entry = this.entry(companyId);
		if (entry[kind] >= this.limits[kind]) return false;
		entry[kind]++;
		return true;
	}

	remaining(companyId: string): { fetches: number; searches: number } {
		const entry = this.entry(companyId);
		return { fetches: this.limits.fetches - entry.fetches, searches: this.limits.searches - entry.searches };
	}
}
