// Hunter.io client: turns a company domain (and optionally a person's name)
// into email addresses with confidence scores. Pure I/O — thresholds, caps,
// and what counts as "verified" are decided by the tool layer, not here.

export type HunterResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type FoundEmail = {
	email: string;
	firstName: string | null;
	lastName: string | null;
	title: string | null;
	/** Hunter's confidence (domain-search) or score (email-finder), 0-100. */
	score: number;
	type: 'personal' | 'generic';
};

const BASE = 'https://api.hunter.io/v2';

type RawEmail = {
	value?: string;
	email?: string;
	type?: string;
	confidence?: number;
	score?: number;
	first_name?: string | null;
	last_name?: string | null;
	position?: string | null;
};

function normalize(raw: RawEmail): FoundEmail | null {
	const email = (raw.value ?? raw.email ?? '').trim().toLowerCase();
	if (!email) return null;
	return {
		email,
		firstName: raw.first_name?.trim() || null,
		lastName: raw.last_name?.trim() || null,
		title: raw.position?.trim() || null,
		score: raw.confidence ?? raw.score ?? 0,
		type: raw.type === 'generic' ? 'generic' : 'personal',
	};
}

export class HunterClient {
	private readonly apiKey: string;
	private readonly doFetch: typeof fetch;

	constructor(apiKey: string, doFetch: typeof fetch = fetch) {
		this.apiKey = apiKey;
		// Stored as an instance property, an unbound native fetch would be
		// called with `this` = the client and throw "Illegal invocation".
		this.doFetch = doFetch.bind(globalThis);
	}

	private async call<T>(path: string, params: Record<string, string>): Promise<HunterResult<T>> {
		const query = new URLSearchParams({ ...params, api_key: this.apiKey });
		let response: Response;
		try {
			response = await this.doFetch(`${BASE}${path}?${query}`, { headers: { accept: 'application/json' } });
		} catch (error) {
			return { ok: false, error: `Hunter request failed: ${error instanceof Error ? error.message : String(error)}` };
		}
		if (!response.ok) {
			return { ok: false, error: `Hunter returned ${response.status}` };
		}
		const body = (await response.json().catch(() => null)) as { data?: T } | null;
		if (!body?.data) return { ok: false, error: 'Hunter returned no data' };
		return { ok: true, data: body.data };
	}

	/** People Hunter knows at a domain, most confident first. */
	async domainSearch(domain: string, limit = 5): Promise<HunterResult<FoundEmail[]>> {
		const result = await this.call<{ emails?: RawEmail[] }>('/domain-search', { domain, limit: String(limit) });
		if (!result.ok) return result;
		const emails = (result.data.emails ?? []).map(normalize).filter((entry): entry is FoundEmail => entry !== null);
		return { ok: true, data: emails.sort((a, b) => b.score - a.score) };
	}

	/** Hunter's best address for a named person at a domain; null when it has none. */
	async emailFinder(domain: string, firstName: string, lastName: string): Promise<HunterResult<FoundEmail | null>> {
		const result = await this.call<RawEmail>('/email-finder', { domain, first_name: firstName, last_name: lastName });
		if (!result.ok) return result;
		return { ok: true, data: normalize(result.data) };
	}
}
