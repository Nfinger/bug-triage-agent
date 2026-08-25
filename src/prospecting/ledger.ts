/**
 * Per-run send accounting. The prompt tells the model to send once per
 * contact; this is what makes it true. An uncertain outcome (timeout on the
 * send call) also consumes the contact — an email that may have gone out is
 * never followed by a second attempt.
 */
export type LedgerEntry = { status: 'sent' | 'drafted' | 'uncertain'; at: string };

export class OutreachLedger {
	private readonly entries = new Map<string, LedgerEntry>();
	private readonly cap: number;

	constructor(cap: number, snapshot?: Record<string, LedgerEntry> | null) {
		this.cap = cap;
		if (snapshot) {
			for (const [contactId, entry] of Object.entries(snapshot)) this.entries.set(contactId, { ...entry });
		}
	}

	/** Plain-JSON form for usePersistentState: the agent re-renders every turn. */
	snapshot(): Record<string, LedgerEntry> {
		return Object.fromEntries([...this.entries.entries()].map(([contactId, entry]) => [contactId, { ...entry }]));
	}

	get sent(): number {
		return [...this.entries.values()].filter((entry) => entry.status === 'sent').length;
	}

	get capReached(): boolean {
		return this.sent >= this.cap;
	}

	has(contactId: string): LedgerEntry | undefined {
		return this.entries.get(contactId);
	}

	/** Reserve the contact before the irreversible call; refuses a repeat. */
	reserve(contactId: string, at: Date): boolean {
		if (this.entries.has(contactId)) return false;
		this.entries.set(contactId, { status: 'uncertain', at: at.toISOString() });
		return true;
	}

	settle(contactId: string, status: LedgerEntry['status']): void {
		const entry = this.entries.get(contactId);
		if (entry) entry.status = status;
	}

	/** A reservation whose guarded step failed before anything was sent. */
	release(contactId: string): void {
		this.entries.delete(contactId);
	}

	summary(): { sent: number; drafted: number; uncertain: number } {
		const counts = { sent: 0, drafted: 0, uncertain: 0 };
		for (const entry of this.entries.values()) counts[entry.status]++;
		return counts;
	}
}
