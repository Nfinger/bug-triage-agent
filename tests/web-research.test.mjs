import assert from 'node:assert/strict';
import test from 'node:test';

import { ResearchBudget } from '../src/prospecting/research-budget.ts';
import { MAX_PAGE_TEXT_BYTES, canonicalUrl, clipText, fetchPageText, htmlToText, urlRefusal } from '../src/prospecting/web.ts';

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
	assert.deepEqual(budget.remaining('a'), { fetches: 0, searches: 0 });
	assert.deepEqual(budget.remaining('b'), { fetches: 1, searches: 1 });
});

test('evidence URLs are matched canonically across slash, www, hash, and case variants', () => {
	assert.equal(canonicalUrl('https://Example.com/events/'), canonicalUrl('https://www.example.com/events'));
	assert.equal(canonicalUrl('https://example.com/'), canonicalUrl('http://example.com'));
	assert.equal(canonicalUrl('https://example.com/a#section'), canonicalUrl('https://example.com/a'));
	assert.notEqual(canonicalUrl('https://example.com/a'), canonicalUrl('https://example.com/b'));
	assert.notEqual(canonicalUrl('https://example.com/a?p=1'), canonicalUrl('https://example.com/a'));
});
