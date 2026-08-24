/**
 * Per-company research allowance for one run, so a single account cannot
 * absorb the whole run in page fetches or searches.
 *
 * Two coupled bounds on fetching: the budget counts pages actually obtained
 * (failed fetches are refunded), while the attempt count is charged for every
 * try and is never given back — so a broken or hostile site cannot absorb
 * unlimited requests through refunds.
 */
export class ResearchBudget {
	private readonly used = new Map<string, { fetches: number; searches: number; fetchAttempts: number }>();
	private readonly discoveryGranted = new Set<string>();
	private readonly baseLimits: { fetches: number; searches: number };
	private readonly discoveryBonus: { fetches: number; searches: number };
	private readonly extraAttempts: number;

	constructor(
		limits: { fetches: number; searches: number } = { fetches: 4, searches: 3 },
		options: { discoveryBonus?: { fetches: number; searches: number }; extraAttempts?: number } = {},
	) {
		this.baseLimits = limits;
		this.discoveryBonus = options.discoveryBonus ?? { fetches: 3, searches: 2 };
		this.extraAttempts = options.extraAttempts ?? 4;
	}

	private entry(companyId: string) {
		let entry = this.used.get(companyId);
		if (!entry) {
			entry = { fetches: 0, searches: 0, fetchAttempts: 0 };
			this.used.set(companyId, entry);
		}
		return entry;
	}

	private limits(companyId: string): { fetches: number; searches: number } {
		if (!this.discoveryGranted.has(companyId)) return this.baseLimits;
		return {
			fetches: this.baseLimits.fetches + this.discoveryBonus.fetches,
			searches: this.baseLimits.searches + this.discoveryBonus.searches,
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
	take(companyId: string, kind: 'fetches' | 'searches'): boolean {
		const entry = this.entry(companyId);
		if (entry[kind] >= this.limits(companyId)[kind]) return false;
		entry[kind]++;
		return true;
	}

	/** Give back a unit taken for an operation that failed. Attempts are never refunded. */
	refund(companyId: string, kind: 'fetches' | 'searches'): void {
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

	remaining(companyId: string): { fetches: number; searches: number; fetchAttempts: number } {
		const entry = this.entry(companyId);
		const limits = this.limits(companyId);
		return {
			fetches: limits.fetches - entry.fetches,
			searches: limits.searches - entry.searches,
			fetchAttempts: this.attemptLimit(companyId) - entry.fetchAttempts,
		};
	}
}
