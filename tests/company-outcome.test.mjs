import assert from 'node:assert/strict';
import test from 'node:test';

import { Crm } from '../src/prospecting/crm.ts';
import { OutreachLedger } from '../src/prospecting/ledger.ts';
import { ResearchBudget } from '../src/prospecting/research-budget.ts';
import { recordCompanyOutcome } from '../src/tools/hubspot-companies.ts';

const NOW = new Date('2026-08-23T13:00:00Z');
const log = { info() {}, warn() {}, error() {}, debug() {} };

// A scripted HubSpot client that records every write.
function scriptedHubspot() {
	const writes = [];
	const client = {
		async call(request) {
			if (request.method === 'GET' && request.path === '/crm/v3/objects/companies/c1') {
				return {
					ok: true,
					data: { id: 'c1', properties: { name: 'Acme', domain: 'acme.io', hubspot_owner_id: '77' }, associations: {} },
				};
			}
			if (request.path === '/crm/v3/objects/notes') {
				writes.push({ kind: 'note', body: request.body });
				return { ok: true, data: { id: 'note-1' } };
			}
			if (request.path === '/crm/v3/objects/tasks') {
				writes.push({ kind: 'task', body: request.body });
				return { ok: true, data: { id: 'task-1' } };
			}
			if (request.method === 'PATCH' && request.path === '/crm/v3/objects/companies/c1') {
				writes.push({ kind: 'mark-prospected', body: request.body });
				return { ok: true, data: {} };
			}
			throw new Error(`unexpected call ${request.method} ${request.path}`);
		},
	};
	return { client, writes };
}

function context(overrides = {}) {
	const { client, writes } = scriptedHubspot();
	return {
		writes,
		context: {
			runDate: '2026-08-23',
			now: () => NOW,
			batch: [{ companyId: 'c1', name: 'Acme', domain: 'acme.io', score: 50, signals: [{ signal: 'icp-fit', weight: 30, detail: 'industry HOSPITALITY' }] }],
			knowledge: { prose: '', icp: { industries: [], sizeRanges: [], geographies: [], personaTitlePatterns: [], excludedDomains: [] }, messaging: {} },
			crm: new Crm(client),
			ledger: overrides.ledger ?? new OutreachLedger(5),
			research: new ResearchBudget(),
			fetchedUrls: new Set(),
			settings: { outreachEnabled: true, dailyCap: 5, cooldownDays: 30, contactsPerCompany: 1, senderEmail: 'x@ourco.com', templateId: () => 1 },
		},
	};
}

test('a skip with no contacts creates a find-a-contact task and still sets the cooldown', async () => {
	const { context: ctx, writes } = context();
	const tool = recordCompanyOutcome(ctx);
	const result = await tool.run({
		data: {
			companyId: 'c1',
			status: 'skipped',
			summary: 'Tried acme.io, /contact (400), /team; searched "Acme" GM and press releases. No named person with an acme.io email.',
			contacts: [],
			sources: ['https://acme.io'],
			skipReason: 'No eligible contacts and discovery found no named person with a company-domain email.',
		},
		log,
	});
	assert.equal(result.output.ok, true);
	assert.equal(result.output.taskId, 'task-1');
	const task = writes.find((write) => write.kind === 'task');
	assert.match(task.body.properties.hs_task_subject, /Find a contact/);
	assert.match(task.body.properties.hs_task_body, /no eligible contact/);
	assert.ok(writes.some((write) => write.kind === 'mark-prospected'), 'skips must still start the cooldown');
});

test('a sent outcome creates the follow-up task, not the find-a-contact task', async () => {
	const ledger = new OutreachLedger(5);
	ledger.reserve('k1', NOW);
	ledger.settle('k1', 'sent');
	const { context: ctx, writes } = context({ ledger });
	const tool = recordCompanyOutcome(ctx);
	const result = await tool.run({
		data: {
			companyId: 'c1',
			status: 'sent',
			summary: 'Emailed Jane about onboarding.',
			contacts: [{ contactId: 'k1', email: 'jane@acme.io', status: 'sent' }],
			sources: ['https://acme.io/about'],
		},
		log,
	});
	assert.equal(result.output.ok, true);
	const task = writes.find((write) => write.kind === 'task');
	assert.match(task.body.properties.hs_task_subject, /Follow up/);
	assert.ok(!/Find a contact/.test(task.body.properties.hs_task_subject));
});

test('a skip that still lists an eligible contact does not file a find-a-contact task', async () => {
	const { context: ctx, writes } = context();
	const tool = recordCompanyOutcome(ctx);
	const result = await tool.run({
		data: {
			companyId: 'c1',
			status: 'skipped',
			summary: 'Contact exists but message could not clear lint; skipped.',
			contacts: [{ contactId: 'k1', email: 'jane@acme.io', status: 'skipped' }],
			sources: [],
			skipReason: 'Could not write a compliant message.',
		},
		log,
	});
	assert.equal(result.output.ok, true);
	assert.equal(result.output.taskId, null);
	assert.equal(writes.filter((write) => write.kind === 'task').length, 0);
});
