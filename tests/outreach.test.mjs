import assert from 'node:assert/strict';
import test from 'node:test';

import { Crm } from '../src/prospecting/crm.ts';
import { OutreachLedger } from '../src/prospecting/ledger.ts';
import { lintMessage } from '../src/prospecting/lint.ts';
import { ResearchBudget } from '../src/prospecting/research-budget.ts';
import { sendOutreachEmail } from '../src/tools/hubspot-outreach.ts';

const NOW = new Date('2026-08-23T13:00:00Z');
const log = { info() {}, warn() {}, error() {}, debug() {} };

const messaging = { maxWords: 120, maxSubjectWords: 8, bannedPhrases: ['just checking in', 'synergy'] };
const icp = { industries: [], sizeRanges: [{ min: 1, max: 10 }], geographies: [], personaTitlePatterns: ['product'], excludedDomains: [] };

// A scripted HubSpot client: answers GET company / batch-read contacts from
// fixtures, records every write.
function scriptedHubspot({ contacts, sendResult } = {}) {
	const writes = [];
	let noteCounter = 0;
	const client = {
		async call(request) {
			if (request.method === 'GET' && request.path === '/crm/v3/objects/companies/c1') {
				return {
					ok: true,
					data: {
						id: 'c1',
						properties: { name: 'Acme', domain: 'acme.io', hubspot_owner_id: '77' },
						associations: { contacts: { results: contacts.map((c) => ({ id: c.id, type: 'company_to_contact' })) } },
					},
				};
			}
			if (request.path === '/crm/v3/objects/contacts/batch/read') {
				return { ok: true, data: { results: contacts } };
			}
			if (request.path === '/crm/v3/objects/notes') {
				writes.push({ kind: 'note', body: request.body });
				return { ok: true, data: { id: `note-${++noteCounter}` } };
			}
			if (request.path === '/marketing/v3/transactional/single-email/send') {
				writes.push({ kind: 'send', body: request.body });
				return sendResult ?? { ok: true, data: { statusId: 'st-1' } };
			}
			throw new Error(`unexpected call ${request.method} ${request.path}`);
		},
	};
	return { client, writes };
}

function context(overrides = {}) {
	return {
		runDate: '2026-08-23',
		now: () => NOW,
		batch: [{ companyId: 'c1', name: 'Acme', domain: 'acme.io', score: 55, signals: [] }],
		knowledge: { prose: '', icp, messaging },
		ledger: new OutreachLedger(overrides.cap ?? 5),
		research: new ResearchBudget(),
		fetchedUrls: new Set(['acme.io/about']),
		settings: {
			outreachEnabled: overrides.outreachEnabled ?? true,
			dailyCap: overrides.cap ?? 5,
			cooldownDays: 30,
			contactsPerCompany: 1,
			senderEmail: 'nate@ourco.com',
			templateId: () => 4242,
		},
		...overrides,
	};
}

const jane = { id: 'k1', properties: { email: 'jane@acme.io', firstname: 'Jane', lastname: 'Doe', jobtitle: 'VP Product' } };
const optedOut = { id: 'k2', properties: { email: 'bob@acme.io', jobtitle: 'Product Lead', hs_email_optout: 'true' } };

const message = {
	companyId: 'c1',
	contactId: 'k1',
	subject: 'Your new onboarding flow',
	body: 'Jane, saw on your about page that Acme just rebuilt onboarding. Teams doing that usually want to know which step loses people; Insights answers that the same day without an analyst. Worth 20 minutes this week? Nate',
	evidence: ['https://acme.io/about'],
};

test('lint rejects over-length, banned phrases, HTML, and unfetched evidence at once', () => {
	const problems = lintMessage(
		{ subject: 'one two three four five six seven eight nine', body: `<b>hi</b> just checking in ${'word '.repeat(130)} unsubscribe here`, evidence: ['https://nope.example/'] },
		messaging,
		new Set(),
	);
	assert.ok(problems.some((p) => /subject is 9 words/.test(p)));
	assert.ok(problems.some((p) => /body is \d+ words; max 120/.test(p)));
	assert.ok(problems.some((p) => /banned phrase "just checking in"/.test(p)));
	assert.ok(problems.some((p) => /plain text, not HTML/.test(p)));
	assert.ok(problems.some((p) => /unsubscribe/.test(p)));
	assert.ok(problems.some((p) => /was not fetched this run/.test(p)));
	assert.deepEqual(lintMessage(message, messaging, new Set(['acme.io/about'])), []);
	assert.deepEqual(lintMessage({ ...message, evidence: ['https://www.acme.io/about/'] }, messaging, new Set(['acme.io/about'])), []);
	assert.deepEqual(lintMessage({ ...message, evidence: ['hubspot:recent_conversion_event_name'] }, messaging, new Set()), []);
});

test('a clean message to an eligible contact is sent once through single-send, to the record address', async () => {
	const { client, writes } = scriptedHubspot({ contacts: [jane] });
	const ctx = context({ crm: new Crm(client) });
	const tool = sendOutreachEmail(ctx);
	const first = await tool.run({ data: message, log });
	assert.deepEqual(first.output, { ok: true, sent: true, contactId: 'k1', to: 'jane@acme.io', sentThisRun: 1 });
	assert.equal(writes.length, 1);
	assert.equal(writes[0].kind, 'send');
	assert.equal(writes[0].body.emailId, 4242);
	assert.equal(writes[0].body.message.to, 'jane@acme.io');
	assert.equal(writes[0].body.message.from, 'nate@ourco.com');
	assert.equal(writes[0].body.customProperties.subject, message.subject);

	const second = await tool.run({ data: message, log });
	assert.equal(second.output.ok, false);
	assert.match(second.output.error, /already handled this run \(sent\)/);
	assert.equal(writes.length, 1, 'nothing else was sent');
});

test('an ineligible contact cannot be sent to even if the model asks', async () => {
	const { client, writes } = scriptedHubspot({ contacts: [jane, optedOut] });
	const tool = sendOutreachEmail(context({ crm: new Crm(client) }));
	const result = await tool.run({ data: { ...message, contactId: 'k2' }, log });
	assert.equal(result.output.ok, false);
	assert.match(result.output.error, /not eligible \(unsubscribed\)/);
	const stranger = await tool.run({ data: { ...message, contactId: 'k9' }, log });
	assert.match(stranger.output.error, /not associated with company/);
	assert.equal(writes.length, 0);
});

test('a message that fails lint is rejected before any CRM write', async () => {
	const { client, writes } = scriptedHubspot({ contacts: [jane] });
	const tool = sendOutreachEmail(context({ crm: new Crm(client) }));
	const result = await tool.run({ data: { ...message, body: `${message.body} synergy` }, log });
	assert.equal(result.output.ok, false);
	assert.deepEqual(result.output.problems, ['contains banned phrase "synergy"']);
	assert.equal(writes.length, 0);
});

test('with OUTREACH_ENABLED off the message becomes a draft note on the contact', async () => {
	const { client, writes } = scriptedHubspot({ contacts: [jane] });
	const ctx = context({ crm: new Crm(client), outreachEnabled: false });
	const result = await sendOutreachEmail(ctx).run({ data: message, log });
	assert.deepEqual(result.output, { ok: true, sent: false, reason: 'outreach-disabled', contactId: 'k1', draftNoteId: 'note-1' });
	assert.equal(writes.length, 1);
	assert.equal(writes[0].kind, 'note');
	assert.equal(writes[0].body.associations[0].to.id, 'k1');
	assert.match(writes[0].body.properties.hs_note_body, /Draft outreach \(2026-08-23\)/);
	assert.equal(ctx.ledger.has('k1').status, 'drafted');
});

test('once the daily cap is reached further sends are drafts', async () => {
	const other = { id: 'k3', properties: { email: 'ann@acme.io', firstname: 'Ann', lastname: 'Lee', jobtitle: 'Product Manager' } };
	const { client, writes } = scriptedHubspot({ contacts: [jane, other] });
	const ctx = context({ crm: new Crm(client), cap: 1 });
	const tool = sendOutreachEmail(ctx);
	const first = await tool.run({ data: message, log });
	assert.equal(first.output.sent, true);
	const second = await tool.run({ data: { ...message, contactId: 'k3' }, log });
	assert.equal(second.output.sent, false);
	assert.equal(second.output.reason, 'daily-cap');
	assert.deepEqual(writes.map((w) => w.kind), ['send', 'note']);
	assert.deepEqual(ctx.ledger.summary(), { sent: 1, drafted: 1, uncertain: 0 });
});

test('an uncertain send outcome is reported, consumed, and never retried', async () => {
	const { client, writes } = scriptedHubspot({
		contacts: [jane],
		sendResult: { ok: false, error: 'HubSpot POST timed out', uncertain: true },
	});
	const ctx = context({ crm: new Crm(client) });
	const tool = sendOutreachEmail(ctx);
	const first = await tool.run({ data: message, log });
	assert.equal(first.output.ok, false);
	assert.equal(first.output.uncertain, true);
	assert.match(first.output.error, /do NOT retry/);
	const retry = await tool.run({ data: message, log });
	assert.match(retry.output.error, /already handled this run \(uncertain\)/);
	assert.equal(writes.length, 1);
});

test('a rejected send releases the contact so the model can report it, and nothing is drafted', async () => {
	const { client, writes } = scriptedHubspot({ contacts: [jane], sendResult: { ok: false, status: 400, error: 'HubSpot POST: 400 bad template' } });
	const ctx = context({ crm: new Crm(client) });
	const result = await sendOutreachEmail(ctx).run({ data: message, log });
	assert.equal(result.output.ok, false);
	assert.match(result.output.error, /bad template/);
	assert.equal(ctx.ledger.has('k1'), undefined);
	assert.equal(writes.length, 1);
});
