/**
 * Per-company research allowance for one run, so a single account cannot
 * absorb the whole run in page fetches or searches.
 *
 * Two coupled bounds on fetching: the budget counts pages actually obtained
 * (failed fetches are refunded), while the attempt count is charged for every
 * try and is never given back — so a broken or hostile site cannot absorb
 * unlimited requests through refunds.
 */
type UsedCounts = { fetches: number; searches: number; lookups: number; fetchAttempts: number; lookupAttempts: number };

/** Plain-JSON form for usePersistentState: the agent re-renders every turn. */
export interface ResearchSnapshot {
	used: Record<string, UsedCounts>;
	discoveryGranted: string[];
}

export class ResearchBudget {
	private readonly used = new Map<string, UsedCounts>();
	private readonly discoveryGranted = new Set<string>();
	private readonly baseLimits: { fetches: number; searches: number; lookups: number };
	private readonly discoveryBonus: { fetches: number; searches: number };
	private readonly extraAttempts: number;

	constructor(
		limits: { fetches: number; searches: number; lookups?: number } = { fetches: 4, searches: 3 },
		options: { discoveryBonus?: { fetches: number; searches: number }; extraAttempts?: number } = {},
		snapshot?: ResearchSnapshot | null,
	) {
		this.baseLimits = { ...limits, lookups: limits.lookups ?? 2 };
		this.discoveryBonus = options.discoveryBonus ?? { fetches: 3, searches: 2 };
		this.extraAttempts = options.extraAttempts ?? 4;
		if (snapshot) {
			for (const [companyId, counts] of Object.entries(snapshot.used)) this.used.set(companyId, { ...counts });
			for (const companyId of snapshot.discoveryGranted) this.discoveryGranted.add(companyId);
		}
	}

	snapshot(): ResearchSnapshot {
		return {
			used: Object.fromEntries([...this.used.entries()].map(([companyId, counts]) => [companyId, { ...counts }])),
			discoveryGranted: [...this.discoveryGranted],
		};
	}

	private entry(companyId: string) {
		let entry = this.used.get(companyId);
		if (!entry) {
			entry = { fetches: 0, searches: 0, lookups: 0, fetchAttempts: 0, lookupAttempts: 0 };
			this.used.set(companyId, entry);
		}
		return entry;
	}

	// Provider lookups are deliberately outside the discovery bonus: their
	// cost is per-call money, not time, so the cap stays flat.
	private limits(companyId: string): { fetches: number; searches: number; lookups: number } {
		if (!this.discoveryGranted.has(companyId)) return this.baseLimits;
		return {
			fetches: this.baseLimits.fetches + this.discoveryBonus.fetches,
			searches: this.baseLimits.searches + this.discoveryBonus.searches,
			lookups: this.baseLimits.lookups,
		};
	}

	private attemptLimit(companyId: string): number {
		return this.limits(companyId).fetches + this.extraAttempts;
	}

	/**
	 * Extra allowance for finding a person when the company has no eligible
	 * contacts. Granted by tool code, never at the model's request, and at
	 * most once per company per run.
	 */
	grantDiscoveryBonus(companyId: string): boolean {
		if (this.discoveryGranted.has(companyId)) return false;
		this.discoveryGranted.add(companyId);
		return true;
	}

	/** Consume one unit; false (and nothing consumed) when the allowance is spent. */
	take(companyId: string, kind: 'fetches' | 'searches' | 'lookups'): boolean {
		const entry = this.entry(companyId);
		if (entry[kind] >= this.limits(companyId)[kind]) return false;
		entry[kind]++;
		return true;
	}

	/** Give back a unit taken for an operation that failed. Attempts are never refunded. */
	refund(companyId: string, kind: 'fetches' | 'searches' | 'lookups'): void {
		const entry = this.entry(companyId);
		if (entry[kind] > 0) entry[kind]--;
	}

	/** Charge one fetch attempt (success or failure); false when the attempt cap is reached. */
	takeAttempt(companyId: string): boolean {
		const entry = this.entry(companyId);
		if (entry.fetchAttempts >= this.attemptLimit(companyId)) return false;
		entry.fetchAttempts++;
		return true;
	}

	/**
	 * Charge one lookup attempt (success or failure). Refunds on provider
	 * failure keep the credit budget honest, so this separate cap
	 * (lookups + 2) is what stops retry loops against a broken provider.
	 */
	takeLookupAttempt(companyId: string): boolean {
		const entry = this.entry(companyId);
		if (entry.lookupAttempts >= this.limits(companyId).lookups + 2) return false;
		entry.lookupAttempts++;
		return true;
	}

	remaining(companyId: string): { fetches: number; searches: number; lookups: number; fetchAttempts: number; lookupAttempts: number } {
		const entry = this.entry(companyId);
		const limits = this.limits(companyId);
		return {
			fetches: limits.fetches - entry.fetches,
			searches: limits.searches - entry.searches,
			lookups: limits.lookups - entry.lookups,
			fetchAttempts: this.attemptLimit(companyId) - entry.fetchAttempts,
			lookupAttempts: limits.lookups + 2 - entry.lookupAttempts,
		};
	}
}
