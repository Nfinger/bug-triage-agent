import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateContacts, exclusionReason } from '../src/prospecting/contacts.ts';
import { Crm } from '../src/prospecting/crm.ts';
import { ResearchBudget } from '../src/prospecting/research-budget.ts';
import { listEligibleContacts } from '../src/tools/hubspot-contacts.ts';

const NOW = new Date('2026-08-23T13:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const icp = {
	industries: ['COMPUTER_SOFTWARE'],
	sizeRanges: [{ min: 20, max: 500 }],
	geographies: [],
	personaTitlePatterns: ['\\b(vp|head) of product\\b', '\\bproduct manager\\b', '\\bhead of data\\b'],
	excludedDomains: ['gmail.com'],
};

const options = { icp, companyDomain: 'acme.io', companyDoNotProspect: false, cooldownDays: 30, now: NOW };

function contact(id, properties) {
	return { id, properties: { email: `${id}@acme.io`, jobtitle: 'Product Manager', ...properties } };
}

test('each hard exclusion is applied regardless of persona fit', () => {
	const cases = [
		[contact('a', { hs_email_optout: 'true' }), 'unsubscribed'],
		[contact('b', { hs_email_hard_bounce_reason_enum: 'UNKNOWN_USER' }), 'hard-bounced'],
		[contact('c', { do_not_contact: 'true' }), 'do-not-contact'],
		[contact('d', { email: 'd@other.com' }), 'foreign-domain'],
		[contact('e', { email: 'e@gmail.com' }), 'excluded-domain'],
		[contact('f', { hs_email_last_send_date: String(NOW.getTime() - 3 * DAY) }), 'recently-emailed'],
		[contact('g', { notes_last_contacted: new Date(NOW.getTime() - 10 * DAY).toISOString() }), 'recently-emailed'],
		[contact('h', { email: '' }), 'no-email'],
	];
	for (const [record, reason] of cases) {
		assert.equal(exclusionReason(record, options), reason, `${record.id} should be ${reason}`);
	}
	assert.equal(exclusionReason(contact('ok', {}), { ...options, companyDoNotProspect: true }), 'company-do-not-prospect');
	assert.equal(exclusionReason(contact('ok', { hs_email_last_send_date: String(NOW.getTime() - 45 * DAY) }), options), undefined);
});

test('a subdomain of the company domain is on-domain', () => {
	assert.equal(exclusionReason(contact('s', { email: 's@mail.acme.io' }), options), undefined);
	assert.equal(exclusionReason(contact('s', { email: 's@acme.io' }), { ...options, companyDomain: 'https://www.acme.io/' }), undefined);
});

test('no company domain means nobody is on-domain', () => {
	assert.equal(exclusionReason(contact('x', {}), { ...options, companyDomain: undefined }), 'foreign-domain');
});

test('survivors are ranked: inbound activity, then persona order, then seniority, then newest', () => {
	const { eligible, excluded } = evaluateContacts(
		[
			contact('pm-old', { jobtitle: 'Product Manager', createdate: '1000' }),
			contact('pm-new', { jobtitle: 'Product Manager', createdate: '2000' }),
			contact('vp', { jobtitle: 'VP of Product' }),
			contact('data', { jobtitle: 'Head of Data' }),
			contact('active', { jobtitle: 'Head of Data', hs_analytics_last_visit_timestamp: String(NOW.getTime() - DAY) }),
			contact('eng', { jobtitle: 'Staff Engineer' }),
			contact('gone', { jobtitle: 'VP of Product', hs_email_optout: 'true' }),
		],
		options,
	);
	assert.deepEqual(
		eligible.map((c) => c.id),
		['active', 'vp', 'pm-new', 'pm-old', 'data'],
	);
	assert.deepEqual(
		excluded.map((c) => [c.id, c.reason]),
		[
			['eng', 'no-persona-match'],
			['gone', 'unsubscribed'],
		],
	);
});

// Tool-level: the discovery bonus is granted by code when nobody is eligible.

function scriptedCrm(contacts) {
	const client = {
		async call(request) {
			if (request.method === 'GET' && request.path === '/crm/v3/objects/companies/c1') {
				return {
					ok: true,
					data: {
						id: 'c1',
						properties: { name: 'Acme', domain: 'acme.io' },
						associations: { contacts: { results: contacts.map((c) => ({ id: c.id, type: 'company_to_contact' })) } },
					},
				};
			}
			if (request.path === '/crm/v3/objects/contacts/batch/read') {
				return { ok: true, data: { results: contacts } };
			}
			throw new Error(`unexpected call ${request.method} ${request.path}`);
		},
	};
	return new Crm(client);
}

function listContext(contacts, research) {
	return {
		runDate: '2026-08-23',
		now: () => NOW,
		batch: [{ companyId: 'c1', name: 'Acme', domain: 'acme.io', score: 55, signals: [] }],
		knowledge: { prose: '', icp, messaging: {} },
		crm: scriptedCrm(contacts),
		ledger: { has: () => undefined },
		research,
		fetchedUrls: new Set(),
		settings: { outreachEnabled: false, dailyCap: 5, cooldownDays: 30, contactsPerCompany: 1, senderEmail: 'x@ourco.com', templateId: () => 1 },
	};
}

const log = { info() {}, warn() {}, error() {}, debug() {} };

test('zero eligible contacts grants the discovery bonus exactly once', async () => {
	const research = new ResearchBudget({ fetches: 4, searches: 3 }, { discoveryBonus: { fetches: 3, searches: 2 } });
	const tool = listEligibleContacts(listContext([contact('eng', { jobtitle: 'Staff Engineer' })], research));

	const first = await tool.run({ data: { companyId: 'c1' }, log });
	assert.equal(first.output.ok, true);
	assert.deepEqual(first.output.contacts, []);
	assert.match(first.output.discovery, /discovery research budget granted/);
	assert.equal(research.remaining('c1').fetches, 7);
	assert.equal(research.remaining('c1').searches, 5);

	const second = await tool.run({ data: { companyId: 'c1' }, log });
	assert.equal(second.output.ok, true);
	assert.equal(research.remaining('c1').fetches, 7, 're-listing must not stack another bonus');
});

test('an eligible contact means no discovery bonus', async () => {
	const research = new ResearchBudget({ fetches: 4, searches: 3 });
	const tool = listEligibleContacts(listContext([contact('pm', { jobtitle: 'Product Manager' })], research));
	const result = await tool.run({ data: { companyId: 'c1' }, log });
	assert.equal(result.output.ok, true);
	assert.equal(result.output.contacts.length, 1);
	assert.equal(result.output.discovery, null);
	assert.equal(research.remaining('c1').fetches, 4);
	assert.equal(research.remaining('c1').searches, 3);
});
