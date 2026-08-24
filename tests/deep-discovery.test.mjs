import assert from 'node:assert/strict';
import test from 'node:test';

import { Crm } from '../src/prospecting/crm.ts';
import { HunterClient } from '../src/prospecting/hunter.ts';
import { ResearchBudget } from '../src/prospecting/research-budget.ts';
import { findContactEmail } from '../src/tools/email-finder.ts';
import { createContact } from '../src/tools/hubspot-contacts.ts';

const log = { info() {}, warn() {}, error() {}, debug() {} };

// --- Hunter client normalization ---

test('domain-search results are normalized and sorted by confidence', async () => {
	const doFetch = async () =>
		new Response(
			JSON.stringify({
				data: {
					emails: [
						{ value: 'Low@acme.io', type: 'personal', confidence: 60, first_name: 'Lo', last_name: 'Wman', position: 'Clerk' },
						{ value: 'jane@acme.io', type: 'personal', confidence: 93, first_name: 'Jane', last_name: 'Doe', position: 'Events Manager' },
						{ value: 'info@acme.io', type: 'generic', confidence: 90 },
					],
				},
			}),
			{ status: 200 },
		);
	const client = new HunterClient('k', doFetch);
	const result = await client.domainSearch('acme.io');
	assert.equal(result.ok, true);
	assert.deepEqual(
		result.data.map((entry) => [entry.email, entry.score, entry.type]),
		[
			['jane@acme.io', 93, 'personal'],
			['info@acme.io', 90, 'generic'],
			['low@acme.io', 60, 'personal'],
		],
	);
});

test('email-finder normalizes score and a provider error is surfaced', async () => {
	const found = new HunterClient('k', async () =>
		new Response(JSON.stringify({ data: { email: 'jim@acme.io', score: 88, first_name: 'Jim', last_name: 'Smith', position: 'GM' } }), { status: 200 }),
	);
	const hit = await found.emailFinder('acme.io', 'Jim', 'Smith');
	assert.equal(hit.ok, true);
	assert.equal(hit.data.email, 'jim@acme.io');
	assert.equal(hit.data.score, 88);

	const limited = new HunterClient('k', async () => new Response('rate limited', { status: 429 }));
	const failure = await limited.domainSearch('acme.io');
	assert.equal(failure.ok, false);
	assert.match(failure.error, /429/);
});

test('the client calls its fetch with a safe this (regression: Illegal invocation)', async () => {
	function strictFetch() {
		if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation: incorrect this reference');
		return Promise.resolve(new Response(JSON.stringify({ data: { emails: [] } }), { status: 200 }));
	}
	const client = new HunterClient('k', strictFetch);
	const result = await client.domainSearch('acme.io');
	assert.equal(result.ok, true);
});

// --- find_contact_email tool ---

function fakeHunter(results) {
	return {
		domainSearch: async () => ({ ok: true, data: results }),
		emailFinder: async (_domain, firstName, lastName) => ({
			ok: true,
			data: results.find((entry) => entry.firstName === firstName && entry.lastName === lastName) ?? null,
		}),
	};
}

function toolContext({ research, crm } = {}) {
	return {
		runDate: '2026-08-24',
		now: () => new Date('2026-08-24T15:00:00Z'),
		batch: [{ companyId: 'c1', name: 'Acme', domain: 'acme.io', score: 50, signals: [] }],
		knowledge: { prose: '', icp: { industries: [], sizeRanges: [], geographies: [], personaTitlePatterns: [], excludedDomains: [] }, messaging: {} },
		crm,
		ledger: { has: () => undefined },
		research: research ?? new ResearchBudget(),
		fetchedUrls: new Set(),
		verifiedEmails: new Map(),
		settings: { outreachEnabled: false, dailyCap: 5, cooldownDays: 30, contactsPerCompany: 1, senderEmail: 'x@ourco.com', templateId: () => 1 },
	};
}

test('only on-domain personal results at or above threshold are recorded as verified', async () => {
	const context = toolContext();
	const tool = findContactEmail(
		context,
		fakeHunter([
			{ email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe', title: 'Events Manager', score: 93, type: 'personal' },
			{ email: 'info@acme.io', firstName: null, lastName: null, title: null, score: 95, type: 'generic' },
			{ email: 'jane@other.com', firstName: 'Jane', lastName: 'Doe', title: null, score: 95, type: 'personal' },
			{ email: 'low@acme.io', firstName: 'Lo', lastName: 'Wman', title: null, score: 60, type: 'personal' },
		]),
	);
	const result = await tool.run({ data: { companyId: 'c1' }, log });
	assert.equal(result.output.ok, true);
	assert.deepEqual(
		result.output.results.map((entry) => [entry.email, entry.verified]),
		[
			['jane@acme.io', true],
			['info@acme.io', false],
			['jane@other.com', false],
			['low@acme.io', false],
		],
	);
	assert.deepEqual([...context.verifiedEmails.keys()], ['jane@acme.io']);
});

test('lookups are budgeted per company and refunded on provider failure', async () => {
	const research = new ResearchBudget({ fetches: 4, searches: 3, lookups: 1 });
	const context = toolContext({ research });
	const failing = { domainSearch: async () => ({ ok: false, error: 'Hunter returned 500' }), emailFinder: async () => ({ ok: false, error: 'x' }) };
	const failure = await findContactEmail(context, failing).run({ data: { companyId: 'c1' }, log });
	assert.equal(failure.output.ok, false);
	assert.equal(context.research.remaining('c1').lookups, 1, 'a failed lookup must be refunded');

	const working = findContactEmail(context, fakeHunter([]));
	const first = await working.run({ data: { companyId: 'c1' }, log });
	assert.equal(first.output.ok, true);
	assert.equal(first.output.remainingLookups, 0);
	const capped = await working.run({ data: { companyId: 'c1' }, log });
	assert.equal(capped.output.ok, false);
	assert.match(capped.output.error, /budget/i);
});

test('a broken provider cannot be retried forever despite refunds', async () => {
	const research = new ResearchBudget({ fetches: 4, searches: 3, lookups: 2 });
	const context = toolContext({ research });
	const failing = { domainSearch: async () => ({ ok: false, error: 'Hunter returned 500' }), emailFinder: async () => ({ ok: false, error: 'x' }) };
	const tool = findContactEmail(context, failing);
	for (let attempt = 0; attempt < 4; attempt++) {
		const result = await tool.run({ data: { companyId: 'c1' }, log });
		assert.equal(result.output.ok, false);
		assert.match(result.output.error, /Hunter returned 500/);
	}
	const capped = await tool.run({ data: { companyId: 'c1' }, log });
	assert.equal(capped.output.ok, false);
	assert.match(capped.output.error, /attempt cap/i);
});

// --- create_contact provider path ---

function scriptedCrm() {
	const writes = [];
	const client = {
		async call(request) {
			if (request.method === 'GET' && request.path === '/crm/v3/objects/companies/c1') {
				return { ok: true, data: { id: 'c1', properties: { name: 'Acme', domain: 'acme.io' }, associations: {} } };
			}
			if (request.method === 'POST' && request.path === '/crm/v3/objects/contacts') {
				writes.push(request.body);
				return { ok: true, data: { id: 'k-new' } };
			}
			throw new Error(`unexpected call ${request.method} ${request.path}`);
		},
	};
	return { crm: new Crm(client), writes };
}

test('a provider-verified email creates a contact without a sourceUrl', async () => {
	const { crm, writes } = scriptedCrm();
	const context = toolContext({ crm });
	context.verifiedEmails.set('jane@acme.io', { firstName: 'Jane', lastName: 'Doe', title: 'Events Manager', score: 93, source: 'hunter' });
	const result = await createContact(context).run({
		data: { companyId: 'c1', firstName: 'Jane', lastName: 'Doe', email: 'jane@acme.io', title: 'Events Manager' },
		log,
	});
	assert.equal(result.output.ok, true);
	assert.equal(writes[0].properties.agent_created, 'true');
});

test('a name mismatching the provider record is refused', async () => {
	const { crm } = scriptedCrm();
	const context = toolContext({ crm });
	context.verifiedEmails.set('jane@acme.io', { firstName: 'Jane', lastName: 'Doe', title: null, score: 93, source: 'hunter' });
	const result = await createContact(context).run({
		data: { companyId: 'c1', firstName: 'Janet', lastName: 'Doe', email: 'jane@acme.io', title: 'Events Manager' },
		log,
	});
	assert.equal(result.output.ok, false);
	assert.match(result.output.error, /does not match the provider/);
});

test('an unverified email without a fetched sourceUrl is refused', async () => {
	const { crm } = scriptedCrm();
	const context = toolContext({ crm });
	const result = await createContact(context).run({
		data: { companyId: 'c1', firstName: 'Jim', lastName: 'Smith', email: 'jim@acme.io', title: 'GM' },
		log,
	});
	assert.equal(result.output.ok, false);
	assert.match(result.output.error, /not provider-verified.*no sourceUrl/);
});
