import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateContacts, exclusionReason } from '../src/prospecting/contacts.ts';

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
