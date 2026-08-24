import assert from 'node:assert/strict';
import test from 'node:test';

import { createHubspotClient } from '../src/channels/hubspot-client.ts';

function client(responses, { onSleep } = {}) {
	const calls = [];
	const doFetch = async (url, init) => {
		calls.push({ url: String(url), init });
		const next = responses.shift();
		if (next instanceof Error) throw next;
		return next;
	};
	const sleeps = [];
	const c = createHubspotClient({ fetch: doFetch, token: () => 'tok', sleep: async (ms) => { sleeps.push(ms); onSleep?.(ms); } });
	return { c, calls, sleeps };
}

test('429 is retried after Retry-After, then succeeds', async () => {
	const { c, calls, sleeps } = client([
		new Response('{"message":"slow down"}', { status: 429, headers: { 'retry-after': '2' } }),
		new Response('{"id":"1"}', { status: 200 }),
	]);
	const result = await c.call({ method: 'GET', path: '/crm/v3/objects/companies/1', query: { properties: 'name' } });
	assert.deepEqual(result, { ok: true, data: { id: '1' } });
	assert.equal(calls.length, 2);
	assert.deepEqual(sleeps, [2000]);
	assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
	assert.match(calls[0].url, /\?properties=name$/);
});

test('persistent 429 gives up with ok:false after the attempt limit', async () => {
	const { c, calls } = client(Array.from({ length: 5 }, () => new Response('', { status: 429 })));
	const result = await c.call({ method: 'GET', path: '/x' });
	assert.equal(result.ok, false);
	assert.match(result.error, /rate limited after 4 attempts/);
	assert.equal(calls.length, 4);
});

test('a non-retryable error is returned with its message, not thrown', async () => {
	const { c } = client([new Response('{"message":"Property does not exist","category":"VALIDATION_ERROR"}', { status: 400 })]);
	const result = await c.call({ method: 'POST', path: '/crm/v3/objects/notes', body: {} });
	assert.equal(result.ok, false);
	assert.equal(result.status, 400);
	assert.match(result.error, /400 VALIDATION_ERROR Property does not exist/);
});

test('a timed-out write is reported as uncertain; a timed-out read is not', async () => {
	const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
	const write = client([timeout()]);
	const sent = await write.c.call({ method: 'POST', path: '/marketing/v3/transactional/single-email/send', body: {} });
	assert.equal(sent.ok, false);
	assert.equal(sent.uncertain, true);
	const read = client([timeout()]);
	const got = await read.c.call({ method: 'GET', path: '/x' });
	assert.equal(got.ok, false);
	assert.equal(got.uncertain, false);
});
