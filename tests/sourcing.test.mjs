import assert from 'node:assert/strict';
import test from 'node:test';

import { Crm } from '../src/prospecting/crm.ts';
import { ResearchBudget } from '../src/prospecting/research-budget.ts';
import { SOURCING_CATEGORIES, focusCategoryFor } from '../src/prospecting/sourcing-categories.ts';
import { canonicalUrl } from '../src/prospecting/web.ts';
import { createCompany } from '../src/tools/hubspot-sourcing.ts';

const log = { info() {}, warn() {}, error() {}, debug() {} };

// --- Category rotation ---

test('focus rotation is deterministic and consecutive weekdays differ', () => {
	assert.equal(focusCategoryFor('2026-08-25').key, focusCategoryFor('2026-08-25').key);
	const week = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'].map((day) => focusCategoryFor(day).key);
	for (let index = 1; index < week.length; index++) {
		assert.notEqual(week[index], week[index - 1], `${week[index - 1]} repeated on consecutive days`);
	}
	// The rotation eventually covers every category.
	const seen = new Set();
	for (let day = 0; day < SOURCING_CATEGORIES.length; day++) {
		const date = new Date(Date.UTC(2026, 7, 24 + day)).toISOString().slice(0, 10);
		seen.add(focusCategoryFor(date).key);
	}
	assert.equal(seen.size, SOURCING_CATEGORIES.length);
});

// --- create_company guardrails ---

const icp = {
	industries: ['HOSPITALITY', 'EVENTS_SERVICES'],
	sizeRanges: [],
	geographies: ['Maine'],
	personaTitlePatterns: [],
	excludedDomains: ['gmail.com'],
};

function scriptedCrm({ existingDomains = [] } = {}) {
	const writes = [];
	const client = {
		async call(request) {
			if (request.path === '/crm/v3/objects/companies/search') {
				const domain = request.body.filterGroups[0].filters[0].value;
				const hit = existingDomains.includes(domain);
				return { ok: true, data: { results: hit ? [{ id: 'existing-1', properties: { name: 'Already Here', domain } }] : [] } };
			}
			if (request.method === 'POST' && request.path === '/crm/v3/objects/companies') {
				writes.push({ kind: 'company', body: request.body });
				return { ok: true, data: { id: `co-${writes.length}` } };
			}
			if (request.path === '/crm/v3/objects/notes') {
				writes.push({ kind: 'note', body: request.body });
				return { ok: true, data: { id: 'note-1' } };
			}
			throw new Error(`unexpected call ${request.method} ${request.path}`);
		},
	};
	return { crm: new Crm(client), writes };
}

function sourcingContext({ crm, fetched = [] } = {}) {
	return {
		runDate: '2026-08-25',
		now: () => new Date('2026-08-25T12:05:00Z'),
		batch: [{ companyId: 'sourcing-run', name: 'Sourcing research', score: 0, signals: [] }],
		knowledge: { prose: '', icp, messaging: {} },
		crm,
		ledger: { has: () => undefined },
		research: new ResearchBudget(),
		fetchedUrls: new Set(fetched.map((url) => canonicalUrl(url))),
		verifiedEmails: new Map(),
		settings: { outreachEnabled: false, dailyCap: 0, cooldownDays: 30, contactsPerCompany: 0, senderEmail: 'x@x.invalid', templateId: () => 0 },
	};
}

const focus = SOURCING_CATEGORIES[0];

const goodInput = {
	name: 'Harvest Barn Events',
	domain: 'harvestbarn.me',
	state: 'ME',
	industry: 'EVENTS_SERVICES',
	websiteUrl: 'https://harvestbarn.me/weddings',
	sourceUrls: ['https://example.com/best-barns-maine'],
};

test('a verified in-territory find is created with markers and a source note', async () => {
	const { crm, writes } = scriptedCrm();
	const state = { focus, max: 5, created: [] };
	const tool = createCompany(sourcingContext({ crm, fetched: ['https://harvestbarn.me/weddings'] }), state);
	const result = await tool.run({ data: goodInput, log });
	assert.equal(result.output.ok, true);
	assert.equal(result.output.remaining, 4);
	const company = writes.find((write) => write.kind === 'company');
	assert.equal(company.body.properties.agent_sourced, 'true');
	assert.equal(company.body.properties.agent_sourced_run, String(Date.UTC(2026, 7, 25)));
	const note = writes.find((write) => write.kind === 'note');
	assert.match(note.body.properties.hs_note_body, /harvestbarn\.me\/weddings/);
	assert.equal(state.created.length, 1);
});

test('every guardrail refuses independently', async () => {
	const cases = [
		[{ ...goodInput, websiteUrl: 'https://harvestbarn.me/unfetched' }, /not fetched this run/, []],
		[{ ...goodInput, state: 'MA' }, /outside the ICP territory/, ['https://harvestbarn.me/weddings']],
		[{ ...goodInput, industry: 'SOFTWARE' }, /not in the ICP industry list/, ['https://harvestbarn.me/weddings']],
		[{ ...goodInput, domain: 'gmail.com' }, /excluded by the ICP/, ['https://harvestbarn.me/weddings']],
	];
	for (const [input, pattern, fetched] of cases) {
		const { crm, writes } = scriptedCrm();
		const tool = createCompany(sourcingContext({ crm, fetched }), { focus, max: 5, created: [] });
		const result = await tool.run({ data: input, log });
		assert.equal(result.output.ok, false, JSON.stringify(input));
		assert.match(result.output.error, pattern);
		assert.equal(writes.length, 0, 'nothing may be written on refusal');
	}
});

test('the wrong-host case names the mismatch when both pages were fetched', async () => {
	const { crm, writes } = scriptedCrm();
	const tool = createCompany(sourcingContext({ crm, fetched: ['https://other-site.com/about'] }), { focus, max: 5, created: [] });
	const result = await tool.run({ data: { ...goodInput, websiteUrl: 'https://other-site.com/about' }, log });
	assert.equal(result.output.ok, false);
	assert.match(result.output.error, /not the company's domain/);
	assert.equal(writes.length, 0);
});

test('duplicates are refused and the cap is enforced in code', async () => {
	const dup = scriptedCrm({ existingDomains: ['harvestbarn.me'] });
	const dupTool = createCompany(sourcingContext({ crm: dup.crm, fetched: ['https://harvestbarn.me/weddings'] }), { focus, max: 5, created: [] });
	const dupResult = await dupTool.run({ data: goodInput, log });
	assert.equal(dupResult.output.ok, false);
	assert.match(dupResult.output.error, /already exists/);

	const { crm } = scriptedCrm();
	const state = { focus, max: 1, created: [] };
	const tool = createCompany(sourcingContext({ crm, fetched: ['https://harvestbarn.me/weddings', 'https://secondbarn.me/'] }), state);
	assert.equal((await tool.run({ data: goodInput, log })).output.ok, true);
	const capped = await tool.run({
		data: { ...goodInput, name: 'Second Barn', domain: 'secondbarn.me', websiteUrl: 'https://secondbarn.me/' },
		log,
	});
	assert.equal(capped.output.ok, false);
	assert.match(capped.output.error, /cap reached/i);
});
