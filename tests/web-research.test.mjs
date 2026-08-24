import assert from 'node:assert/strict';
import test from 'node:test';

import { ResearchBudget } from '../src/prospecting/research-budget.ts';
import { MAX_PAGE_TEXT_BYTES, canonicalUrl, clipText, fetchPageText, htmlToText, urlRefusal } from '../src/prospecting/web.ts';
import { fetchPage } from '../src/tools/web-research.ts';

test('SSRF guard refuses internal, private, and non-http targets', () => {
	const refused = [
		'ftp://example.com/x',
		'file:///etc/passwd',
		'http://localhost/',
		'http://127.0.0.1/',
		'http://10.1.2.3/',
		'http://172.20.0.1/',
		'http://192.168.1.1/',
		'http://169.254.169.254/latest/meta-data',
		'http://[::1]/',
		'http://[fd00::1]/',
		'http://metadata.google.internal/',
		'http://intranet/',
		'http://user:pw@example.com/',
		'not a url',
	];
	for (const url of refused) assert.ok(urlRefusal(url), `${url} should be refused`);
	assert.equal(urlRefusal('https://example.com/about'), undefined);
	assert.equal(urlRefusal('http://8.8.8.8/'), undefined);
});

test('redirects are re-checked at every hop', async () => {
	const calls = [];
	const doFetch = async (url) => {
		calls.push(String(url));
		return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
	};
	const result = await fetchPageText('https://example.com/', doFetch);
	assert.equal(result.ok, false);
	assert.match(result.error, /127\.0\.0\.1.*private/);
	assert.deepEqual(calls, ['https://example.com/']);
});

test('html is reduced to visible text, scripts and nav dropped, entities decoded', () => {
	const html = `<html><head><title>Acme &amp; Co</title><script>alert(1)</script><style>p{}</style></head>
	<body><nav>Home About</nav><h1>Acme</h1><p>We build &quot;analytics&quot; tools.</p><footer>legal</footer></body></html>`;
	const text = htmlToText(html);
	assert.ok(!text.includes('alert'));
	assert.ok(!text.includes('Home About'));
	assert.ok(!text.includes('legal'));
	assert.match(text, /Acme\nWe build "analytics" tools\./);
});

test('page text is capped and marked truncated', async () => {
	const doFetch = async () =>
		new Response(`<html><title>Big</title><body><p>${'word '.repeat(20_000)}</p></body></html>`, {
			status: 200,
			headers: { 'content-type': 'text/html; charset=utf-8' },
		});
	const result = await fetchPageText('https://example.com/big', doFetch);
	assert.equal(result.ok, true);
	assert.equal(result.title, 'Big');
	assert.equal(result.truncated, true);
	assert.ok(Buffer.byteLength(result.text) <= MAX_PAGE_TEXT_BYTES);
	assert.equal(clipText('short').truncated, false);
});

test('non-text responses are refused', async () => {
	const doFetch = async () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
	const result = await fetchPageText('https://example.com/deck.pdf', doFetch);
	assert.equal(result.ok, false);
	assert.match(result.error, /not a text page/);
});

test('research budget is per company and per kind', () => {
	const budget = new ResearchBudget({ fetches: 2, searches: 1 });
	assert.equal(budget.take('a', 'fetches'), true);
	assert.equal(budget.take('a', 'fetches'), true);
	assert.equal(budget.take('a', 'fetches'), false);
	assert.equal(budget.take('a', 'searches'), true);
	assert.equal(budget.take('a', 'searches'), false);
	assert.equal(budget.take('b', 'fetches'), true);
	assert.deepEqual(budget.remaining('a'), { fetches: 0, searches: 0, lookups: 2, fetchAttempts: 6, lookupAttempts: 4 });
	assert.deepEqual(budget.remaining('b'), { fetches: 1, searches: 1, lookups: 2, fetchAttempts: 6, lookupAttempts: 4 });
});

test('discovery bonus expands both allowances and is granted at most once', () => {
	const budget = new ResearchBudget({ fetches: 1, searches: 1 }, { discoveryBonus: { fetches: 2, searches: 1 }, extraAttempts: 4 });
	assert.equal(budget.take('a', 'fetches'), true);
	assert.equal(budget.take('a', 'fetches'), false);
	assert.equal(budget.grantDiscoveryBonus('a'), true);
	assert.equal(budget.grantDiscoveryBonus('a'), false);
	assert.deepEqual(budget.remaining('a'), { fetches: 2, searches: 2, lookups: 2, fetchAttempts: 7, lookupAttempts: 4 });
	assert.equal(budget.take('a', 'fetches'), true);
	assert.equal(budget.take('a', 'searches'), true);
	assert.equal(budget.take('a', 'searches'), true);
	assert.equal(budget.take('a', 'searches'), false);
	assert.deepEqual(budget.remaining('b'), { fetches: 1, searches: 1, lookups: 2, fetchAttempts: 5, lookupAttempts: 4 });
});

test('refunds restore a unit but never go below zero used', () => {
	const budget = new ResearchBudget({ fetches: 1, searches: 1 });
	assert.equal(budget.take('a', 'fetches'), true);
	budget.refund('a', 'fetches');
	assert.equal(budget.remaining('a').fetches, 1);
	budget.refund('a', 'fetches');
	assert.equal(budget.remaining('a').fetches, 1, 'refund without a matching take must not raise the allowance');
	assert.equal(budget.take('a', 'fetches'), true);
	assert.equal(budget.take('a', 'fetches'), false);
});

test('attempt cap blocks fetch attempts even while fetch budget remains', () => {
	const budget = new ResearchBudget({ fetches: 3, searches: 1 }, { extraAttempts: 1 });
	for (let i = 0; i < 4; i++) assert.equal(budget.takeAttempt('a'), true, `attempt ${i + 1}`);
	assert.equal(budget.takeAttempt('a'), false);
	assert.equal(budget.remaining('a').fetches, 3, 'attempts alone must not consume the fetch budget');
	assert.equal(budget.remaining('a').fetchAttempts, 0);
});

function toolContext(research) {
	return {
		runDate: '2026-08-23',
		now: () => new Date('2026-08-23T13:00:00Z'),
		batch: [{ companyId: 'c1', name: 'Acme', domain: 'acme.io', score: 55, signals: [] }],
		knowledge: { prose: '', icp: { industries: [], sizeRanges: [], geographies: [], personaTitlePatterns: [], excludedDomains: [] }, messaging: {} },
		ledger: { has: () => undefined },
		research,
		fetchedUrls: new Set(),
		settings: { outreachEnabled: false, dailyCap: 5, cooldownDays: 30, contactsPerCompany: 1, senderEmail: 'x@ourco.com', templateId: () => 1 },
	};
}

test('a failed fetch is refunded but attempts stay bounded', async () => {
	const research = new ResearchBudget({ fetches: 2, searches: 1 }, { extraAttempts: 1 });
	const context = toolContext(research);
	const doFetch = async () => new Response('nope', { status: 400, headers: { 'content-type': 'text/html' } });
	const tool = fetchPage(context, doFetch);

	const first = await tool.run({ data: { companyId: 'c1', url: 'https://acme.io/contact' }, log: { info() {} } });
	assert.equal(first.output.ok, false);
	assert.match(first.output.error, /fetch budget not charged/);
	assert.equal(research.remaining('c1').fetches, 2, 'a 400 must leave the fetch budget untouched');
	assert.equal(context.fetchedUrls.size, 0);

	// Attempt cap is fetches (2) + extraAttempts (1) = 3: two more failures allowed, then capped.
	const second = await tool.run({ data: { companyId: 'c1', url: 'https://acme.io/contact-us' }, log: { info() {} } });
	assert.equal(second.output.ok, false);
	const third = await tool.run({ data: { companyId: 'c1', url: 'https://acme.io/about' }, log: { info() {} } });
	assert.equal(third.output.ok, false);
	const capped = await tool.run({ data: { companyId: 'c1', url: 'https://acme.io/team' }, log: { info() {} } });
	assert.equal(capped.output.ok, false);
	assert.match(capped.output.error, /attempt cap reached/i);
	assert.equal(research.remaining('c1').fetches, 2, 'the budget survives even when attempts run out');
});

test('a successful fetch still charges the budget and records evidence URLs', async () => {
	const research = new ResearchBudget({ fetches: 1, searches: 1 });
	const context = toolContext(research);
	const doFetch = async () =>
		new Response('<html><title>Team</title><body><p>Pat Smith, GM — pat@acme.io</p></body></html>', {
			status: 200,
			headers: { 'content-type': 'text/html' },
		});
	const tool = fetchPage(context, doFetch);
	const result = await tool.run({ data: { companyId: 'c1', url: 'https://acme.io/team' }, log: { info() {} } });
	assert.equal(result.output.ok, true);
	assert.equal(result.output.remainingFetches, 0);
	assert.ok(context.fetchedUrls.has(canonicalUrl('https://acme.io/team')));
});

test('evidence URLs are matched canonically across slash, www, hash, and case variants', () => {
	assert.equal(canonicalUrl('https://Example.com/events/'), canonicalUrl('https://www.example.com/events'));
	assert.equal(canonicalUrl('https://example.com/'), canonicalUrl('http://example.com'));
	assert.equal(canonicalUrl('https://example.com/a#section'), canonicalUrl('https://example.com/a'));
	assert.notEqual(canonicalUrl('https://example.com/a'), canonicalUrl('https://example.com/b'));
	assert.notEqual(canonicalUrl('https://example.com/a?p=1'), canonicalUrl('https://example.com/a'));
});
