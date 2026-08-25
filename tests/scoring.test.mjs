import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_WEIGHTS, exclusionReason, matchesGeography, rankCompanies, scoreCompany } from '../src/prospecting/scoring.ts';

const NOW = new Date('2026-08-23T13:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const icp = {
	industries: ['COMPUTER_SOFTWARE'],
	sizeRanges: [{ min: 20, max: 500 }],
	geographies: ['United States'],
	personaTitlePatterns: ['x'],
	excludedDomains: [],
};
const options = { icp, lookbackDays: 30, cooldownDays: 30, now: NOW };

function snapshot(id, properties, deals = []) {
	return {
		company: { id, properties: { name: id, domain: `${id}.io`, ...properties }, contactIds: [], dealIds: deals.map((d) => d.id) },
		deals,
	};
}

test('scoring is deterministic and weights add up', () => {
	const snap = snapshot('a', {
		recent_conversion_date: String(NOW.getTime() - 2 * DAY),
		recent_conversion_event_name: 'Pricing form',
		hs_analytics_last_visit_timestamp: String(NOW.getTime() - DAY),
		industry: 'COMPUTER_SOFTWARE',
		numberofemployees: '120',
		country: 'United States',
	});
	const first = scoreCompany(snap, options);
	const second = scoreCompany(snap, options);
	assert.deepEqual(first, second);
	assert.equal(first.score, DEFAULT_WEIGHTS.formSubmission + DEFAULT_WEIGHTS.websiteVisit + DEFAULT_WEIGHTS.icpFit);
	assert.deepEqual(
		first.signals.map((s) => s.signal),
		['form-submission', 'website-visit', 'icp-fit'],
	);
});

test('a form submission outranks an otherwise identical company', () => {
	const base = { hs_analytics_last_visit_timestamp: String(NOW.getTime() - DAY) };
	const without = scoreCompany(snapshot('a', base), options);
	const withForm = scoreCompany(snapshot('b', { ...base, recent_conversion_date: String(NOW.getTime() - DAY) }), options);
	assert.ok(withForm.score > without.score);
});

test('signals outside the lookback window do not count', () => {
	const stale = scoreCompany(snapshot('a', { recent_conversion_date: String(NOW.getTime() - 45 * DAY) }), options);
	assert.ok(!stale.signals.some((s) => s.signal === 'form-submission'));
});

test('open deals and stage advances count; closed deals do not', () => {
	const open = { id: 'd1', properties: { dealname: 'Acme expansion', dealstage: 'qualified', hs_is_closed: 'false', hs_lastmodifieddate: String(NOW.getTime() - DAY) } };
	const closedLost = { id: 'd2', properties: { dealname: 'Old', hs_is_closed: 'true', hs_is_closed_won: 'false', hs_lastmodifieddate: String(NOW.getTime() - DAY) } };
	const result = scoreCompany(snapshot('a', { hs_date_entered_opportunity: String(NOW.getTime() - 5 * DAY) }, [open, closedLost]), options);
	assert.deepEqual(
		result.signals.map((s) => s.signal),
		['open-deal', 'stage-advance'],
	);
	assert.match(result.signals[0].detail, /Acme expansion/);
});

test('exclusions: customers, closed-won, do-not-prospect, cooldown, no domain', () => {
	assert.equal(exclusionReason(snapshot('a', { lifecyclestage: 'customer' }), options), 'customer');
	assert.equal(exclusionReason(snapshot('a', { hs_date_entered_customer: '1000' }), options), 'customer');
	assert.equal(exclusionReason(snapshot('a', {}, [{ id: 'w', properties: { hs_is_closed_won: 'true' } }]), options), 'closed-won-deal');
	assert.equal(exclusionReason(snapshot('a', { do_not_prospect: 'true' }), options), 'do-not-prospect');
	assert.equal(exclusionReason(snapshot('a', { last_prospected_at: String(NOW.getTime() - 10 * DAY) }), options), 'cooldown');
	assert.equal(exclusionReason(snapshot('a', { last_prospected_at: String(NOW.getTime() - 40 * DAY) }), options), undefined);
	assert.equal(exclusionReason(snapshot('a', { domain: '' }), options), 'no-domain');
});

test('ranking caps the batch, drops fit-only companies, and counts exclusions', () => {
	const hot = (id, ms) => snapshot(id, { recent_conversion_date: String(NOW.getTime() - ms), industry: 'COMPUTER_SOFTWARE' });
	const { selected, excluded } = rankCompanies(
		[
			hot('c', 3 * DAY),
			hot('a', DAY),
			snapshot('fit-only', { industry: 'COMPUTER_SOFTWARE', numberofemployees: '50', country: 'United States' }),
			snapshot('cust', { lifecyclestage: 'customer', recent_conversion_date: String(NOW.getTime()) }),
			hot('b', 2 * DAY),
		],
		options,
		2,
	);
	assert.deepEqual(selected.map((entry) => entry.companyId), ['a', 'b']);
	assert.equal(selected[0].domain, 'a.io');
	assert.ok(selected[0].signals.length >= 1);
	assert.equal(excluded['no-signal'], 1);
	assert.equal(excluded.customer, 1);
});

test('geography fit matches state name, state code, or country', () => {
	assert.equal(matchesGeography(['Maine'], 'ME', null), true);
	assert.equal(matchesGeography(['Maine'], 'maine', 'United States'), true);
	assert.equal(matchesGeography(['ME'], 'Maine', null), true);
	assert.equal(matchesGeography(['Maine'], 'MA', 'United States'), false);
	assert.equal(matchesGeography(['United States'], null, 'united states'), true);
	assert.equal(matchesGeography(['United States'], 'ME', null), false);

	const maineIcp = { ...icp, geographies: ['Maine'] };
	const inMaine = scoreCompany(
		snapshot('a', { recent_conversion_date: String(NOW.getTime() - DAY), state: 'ME' }),
		{ ...options, icp: maineIcp },
	);
	assert.ok(inMaine.signals.find((s) => s.signal === 'icp-fit')?.detail.includes('location ME'));
	const elsewhere = scoreCompany(
		snapshot('b', { recent_conversion_date: String(NOW.getTime() - DAY), state: 'MA', country: 'United States' }),
		{ ...options, icp: maineIcp },
	);
	assert.ok(!elsewhere.signals.some((s) => s.signal === 'icp-fit'));
});

test('sourced-fresh makes a fit-only sourced company selectable, below warm accounts', () => {
	const sourced = snapshot('sourced', {
		agent_sourced: 'true',
		agent_sourced_run: String(NOW.getTime() - 2 * DAY),
		industry: 'COMPUTER_SOFTWARE',
		numberofemployees: '50',
		country: 'United States',
	});
	const scored = scoreCompany(sourced, options);
	assert.deepEqual(
		scored.signals.map((s) => s.signal),
		['sourced-fresh', 'icp-fit'],
	);
	assert.equal(scored.score, DEFAULT_WEIGHTS.sourcedFresh + DEFAULT_WEIGHTS.icpFit);

	const warm = snapshot('warm', {
		recent_conversion_date: String(NOW.getTime() - DAY),
		industry: 'COMPUTER_SOFTWARE',
		numberofemployees: '50',
		country: 'United States',
	});
	const { selected } = rankCompanies([sourced, warm], options, 5);
	assert.deepEqual(
		selected.map((entry) => entry.companyId),
		['warm', 'sourced'],
		'a real inbound signal must outrank sourced-fresh',
	);
});

test('sourced-fresh expires with the lookback window', () => {
	const stale = snapshot('stale', {
		agent_sourced: 'true',
		agent_sourced_run: String(NOW.getTime() - 31 * DAY),
		industry: 'COMPUTER_SOFTWARE',
		numberofemployees: '50',
		country: 'United States',
	});
	const { selected, excluded } = rankCompanies([stale], options, 5);
	assert.equal(selected.length, 0);
	assert.equal(excluded['no-signal'], 1);

	const unsourced = snapshot('plain', { agent_sourced_run: String(NOW.getTime() - DAY) });
	assert.ok(!scoreCompany(unsourced, options).signals.some((s) => s.signal === 'sourced-fresh'), 'the run date alone, without the marker, is not a signal');
});
