import assert from 'node:assert/strict';
import test from 'node:test';

import { Crm } from '../src/prospecting/crm.ts';

// The route module reaches the schedule, which bundles docs/business/*.md via
// `.md?raw` imports — register the raw-markdown loader before importing it.
const { registerHooks } = await import('node:module');
const { load } = await import('../scripts/md-raw-loader.mjs');
registerHooks({ load });
const { route } = await import('../src/schedules/prospecting-manual.ts');

// CRM helpers behind the manual-run endpoint.

function scriptedClient({ found = true } = {}) {
	const calls = [];
	const client = {
		async call(request) {
			calls.push(request);
			if (request.path === '/crm/v3/objects/companies/search') {
				return { ok: true, data: { results: found ? [{ id: 'c9', properties: { name: 'Point Lookout', domain: 'visitpointlookout.com' } }] : [] } };
			}
			if (request.method === 'PATCH' && request.path === '/crm/v3/objects/companies/c9') {
				return { ok: true, data: {} };
			}
			throw new Error(`unexpected call ${request.method} ${request.path}`);
		},
	};
	return { client, calls };
}

test('findCompanyByDomain returns the match or null', async () => {
	const hit = new Crm(scriptedClient().client);
	const foundResult = await hit.findCompanyByDomain('visitpointlookout.com');
	assert.equal(foundResult.ok, true);
	assert.equal(foundResult.data.id, 'c9');

	const miss = new Crm(scriptedClient({ found: false }).client);
	const missResult = await miss.findCompanyByDomain('nobody.example');
	assert.equal(missResult.ok, true);
	assert.equal(missResult.data, null);
});

test('clearProspected writes an empty last_prospected_at', async () => {
	const { client, calls } = scriptedClient();
	const crm = new Crm(client);
	const result = await crm.clearProspected('c9');
	assert.equal(result.ok, true);
	const patch = calls.find((call) => call.method === 'PATCH');
	assert.deepEqual(patch.body, { properties: { last_prospected_at: '' } });
});

// Route auth. These paths return before any CRM or dispatch work, so no
// HubSpot config is needed.

test('the route does not exist without the token secret', async () => {
	delete process.env.PROSPECTING_MANUAL_TOKEN;
	const response = await route().request('/run', { method: 'POST' });
	assert.equal(response.status, 404);
});

test('a missing or wrong bearer token is rejected', async () => {
	process.env.PROSPECTING_MANUAL_TOKEN = 'right-token';
	try {
		const missing = await route().request('/run', { method: 'POST' });
		assert.equal(missing.status, 401);
		const wrong = await route().request('/run', { method: 'POST', headers: { authorization: 'Bearer wrong-token' } });
		assert.equal(wrong.status, 401);
	} finally {
		delete process.env.PROSPECTING_MANUAL_TOKEN;
	}
});
