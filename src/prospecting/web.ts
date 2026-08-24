/**
 * The research tools' pure parts: URL safety, HTML-to-text, and the search
 * provider adapter. Kept free of Flue so they can be unit-tested directly.
 */

export const MAX_PAGE_TEXT_BYTES = 20 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Hostnames and address ranges a research fetch must never reach: anything
// local, link-local, private, or cloud-metadata.
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata']);

function isPrivateIpv4(ip: string): boolean {
	const parts = ip.split('.').map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
	const [a, b] = parts as [number, number, number, number];
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) ||
		a >= 224
	);
}

function isPrivateIpv6(ip: string): boolean {
	const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
	if (lower === '::' || lower === '::1') return true;
	if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
	if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
	if (lower.startsWith('::ffff:')) return isPrivateIpv4(lower.slice(7));
	return false;
}

/** Why a URL may not be fetched, or undefined when it may. */
export function urlRefusal(raw: string): string | undefined {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return 'not a valid absolute URL';
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return `scheme "${url.protocol}" is not allowed; only http and https`;
	if (url.username || url.password) return 'credentials in URLs are not allowed';
	const host = url.hostname.toLowerCase();
	if (!host) return 'missing host';
	if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
		return `host "${host}" is internal`;
	}
	if (!host.includes('.') && !host.includes(':')) return `host "${host}" is not a public hostname`;
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIpv4(host)) return `address ${host} is private`;
	if (host.includes(':') && isPrivateIpv6(host)) return `address ${host} is private`;
	return undefined;
}

/**
 * Canonical form for "was this URL fetched this run?" bookkeeping: exact
 * string equality is too brittle (trailing slash, hash, www-redirects, case
 * in the host all vary between what the model passes, what the server
 * redirects to, and what the model later cites as evidence).
 */
export function canonicalUrl(raw: string): string {
	try {
		const url = new URL(raw);
		url.hash = '';
		let host = url.hostname.toLowerCase().replace(/^www\./, '');
		let path = url.pathname.replace(/\/+$/, '');
		return `${host}${path}${url.search}`;
	} catch {
		return raw.trim().toLowerCase();
	}
}

const DROP_TAGS = ['script', 'style', 'noscript', 'svg', 'iframe', 'template', 'nav', 'footer', 'header', 'aside', 'form'];

/** Visible text from an HTML document, whitespace-collapsed. Never evaluates anything. */
export function htmlToText(html: string): string {
	let text = html;
	for (const tag of DROP_TAGS) {
		text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
	}
	text = text
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/[ \t\r\f\v]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return text;
}

export function clipText(text: string, maxBytes = MAX_PAGE_TEXT_BYTES): { text: string; truncated: boolean } {
	if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
	let clipped = text.slice(0, maxBytes);
	while (Buffer.byteLength(clipped, 'utf8') > maxBytes) clipped = clipped.slice(0, -64);
	return { text: clipped, truncated: true };
}

export interface FetchedPage {
	ok: true;
	url: string;
	finalUrl: string;
	status: number;
	title: string | null;
	text: string;
	truncated: boolean;
}

export type FetchOutcome = FetchedPage | { ok: false; error: string };

/**
 * Fetch a public page and return its text. Redirects are followed by hand so
 * every hop is re-checked against the SSRF rules.
 */
export async function fetchPageText(raw: string, doFetch: typeof fetch = fetch): Promise<FetchOutcome> {
	let current = raw;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const refusal = urlRefusal(current);
		if (refusal) return { ok: false, error: `Refusing to fetch ${current}: ${refusal}` };
		let response: Response;
		try {
			response = await doFetch(current, {
				redirect: 'manual',
				headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'user-agent': 'prospecting-agent/1.0 (+research)' },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
		} catch (error) {
			return { ok: false, error: `Fetch of ${current} failed: ${error instanceof Error ? error.message : String(error)}` };
		}
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location) return { ok: false, error: `Redirect from ${current} without a location` };
			current = new URL(location, current).toString();
			continue;
		}
		if (!response.ok) return { ok: false, error: `${current} returned ${response.status}` };
		const contentType = response.headers.get('content-type') ?? '';
		if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
			return { ok: false, error: `${current} is ${contentType || 'an unknown content type'}, not a text page` };
		}
		const body = (await response.text()).slice(0, MAX_BODY_BYTES);
		const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
		const { text, truncated } = clipText(/text\/plain/i.test(contentType) ? body : htmlToText(body));
		return { ok: true, url: raw, finalUrl: current, status: response.status, title, text, truncated };
	}
	return { ok: false, error: `Too many redirects from ${raw}` };
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	age?: string | null;
}

export interface SearchProvider {
	search(query: string, count: number): Promise<{ ok: true; results: SearchResult[] } | { ok: false; error: string }>;
}

/** Brave Search API adapter. Swap the provider by implementing SearchProvider. */
export function braveSearch(apiKey: string, doFetch: typeof fetch = fetch): SearchProvider {
	return {
		async search(query, count) {
			const url = new URL('https://api.search.brave.com/res/v1/web/search');
			url.searchParams.set('q', query);
			url.searchParams.set('count', String(count));
			url.searchParams.set('text_decorations', 'false');
			let response: Response;
			try {
				response = await doFetch(url, {
					headers: { accept: 'application/json', 'x-subscription-token': apiKey },
					signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				});
			} catch (error) {
				return { ok: false, error: `Search failed: ${error instanceof Error ? error.message : String(error)}` };
			}
			if (!response.ok) return { ok: false, error: `Search provider returned ${response.status}` };
			const body = (await response.json()) as { web?: { results?: { title?: string; url?: string; description?: string; age?: string }[] } };
			return {
				ok: true,
				results: (body.web?.results ?? []).slice(0, count).map((result) => ({
					title: result.title ?? '',
					url: result.url ?? '',
					snippet: result.description ?? '',
					age: result.age ?? null,
				})),
			};
		},
	};
}
