import { hubspotToken } from '../prospecting/config.ts';

// Outbound HubSpot access for the prospecting agent. A thin fetch wrapper
// rather than the official SDK: it runs unchanged inside a Worker, and tests
// can substitute `fetch`. The portal is whatever the configured private-app
// token belongs to — nothing here takes a portal or token from a caller.

const BASE_URL = 'https://api.hubapi.com';
const MAX_ATTEMPTS = 4;
const DEFAULT_BACKOFF_MS = 1_500;
const REQUEST_TIMEOUT_MS = 15_000;

export type HubspotResult<T> = { ok: true; data: T } | { ok: false; status?: number; error: string; uncertain?: boolean };

export interface HubspotRequest {
	method: 'GET' | 'POST' | 'PATCH' | 'PUT';
	path: string;
	query?: Record<string, string | number | undefined>;
	body?: unknown;
}

export interface HubspotClient {
	call<T = unknown>(request: HubspotRequest): Promise<HubspotResult<T>>;
}

export interface ClientOptions {
	fetch?: typeof fetch;
	token?: () => string;
	sleep?: (ms: number) => Promise<void>;
}

function retryAfterMs(response: Response): number {
	const header = response.headers.get('retry-after');
	const seconds = header ? Number(header) : NaN;
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_BACKOFF_MS;
}

async function errorMessage(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { message?: string; category?: string };
		if (body?.message) return `${response.status} ${body.category ?? ''} ${body.message}`.replace(/\s+/g, ' ').trim();
	} catch {
		// fall through to the status line
	}
	return `${response.status} ${response.statusText}`.trim();
}

export function createHubspotClient(options: ClientOptions = {}): HubspotClient {
	const doFetch = options.fetch ?? fetch;
	const token = options.token ?? hubspotToken;
	const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

	return {
		async call<T>(request: HubspotRequest): Promise<HubspotResult<T>> {
			const url = new URL(request.path, BASE_URL);
			for (const [key, value] of Object.entries(request.query ?? {})) {
				if (value !== undefined) url.searchParams.set(key, String(value));
			}
			for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
				let response: Response;
				try {
					response = await doFetch(url, {
						method: request.method,
						headers: {
							authorization: `Bearer ${token()}`,
							'content-type': 'application/json',
							accept: 'application/json',
						},
						body: request.body === undefined ? undefined : JSON.stringify(request.body),
						signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
					});
				} catch (error) {
					// A timeout on a write may have been applied; say so rather than
					// retrying into a duplicate.
					const isTimeout = error instanceof Error && error.name === 'TimeoutError';
					return {
						ok: false,
						error: `HubSpot ${request.method} ${request.path} failed: ${error instanceof Error ? error.message : String(error)}`,
						uncertain: isTimeout && request.method !== 'GET',
					};
				}
				if (response.status === 429) {
					if (attempt < MAX_ATTEMPTS) {
						await sleep(retryAfterMs(response));
						continue;
					}
					return { ok: false, status: 429, error: `HubSpot ${request.method} ${request.path}: rate limited after ${MAX_ATTEMPTS} attempts` };
				}
				if (!response.ok) {
					return {
						ok: false,
						status: response.status,
						error: `HubSpot ${request.method} ${request.path}: ${await errorMessage(response)}`,
					};
				}
				if (response.status === 204) return { ok: true, data: undefined as T };
				return { ok: true, data: (await response.json()) as T };
			}
			return { ok: false, error: `HubSpot ${request.method} ${request.path}: unreachable` };
		},
	};
}

let shared: HubspotClient | undefined;

/** Process-wide client on the configured token. */
export function hubspot(): HubspotClient {
	shared ??= createHubspotClient();
	return shared;
}
