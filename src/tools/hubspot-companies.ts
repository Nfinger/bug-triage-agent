import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { isTrue, timestampMs } from '../prospecting/crm.ts';
import { inBatch, type RunContext } from '../prospecting/run-context.ts';

// Company-level reads and the run's audit trail. Only companies the
// dispatcher selected can be read or written: the batch, not the model,
// decides which accounts this run touches.

type ToolError = { ok: false; error: string };

// Annotated because each tool has several exits: without it the inferred
// union widens into optional-undefined members.
type Json = string | number | boolean | null;
type GetCompanyOutput =
	| ToolError
	| { ok: true; company: Record<string, Json>; selection: { score: number; signals: { signal: string; weight: number; detail: string }[] }; openDeals: Record<string, Json>[] };
type RecordOutcomeOutput =
	| ToolError
	| { ok: true; noteId: string; taskId: string | null; markedProspected: boolean; contacts: { contactId: string; status: string }[] };

function errorOutput(error: unknown): ToolError {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function notInBatch(companyId: string): ToolError {
	return { ok: false, error: `Company ${companyId} is not in this run's batch; only selected companies can be read or written` };
}

function iso(value: string | null | undefined): string | null {
	const ms = timestampMs(value);
	return ms ? new Date(ms).toISOString() : null;
}

export function getCompany(context: RunContext) {
	return defineTool({
		name: 'get_company',
		description:
			'Read one selected company from HubSpot: its properties, why it was selected, its open deals, ' +
			'and a count of associated contacts. Call list_eligible_contacts to see who can be emailed.',
		input: v.object({ companyId: v.pipe(v.string(), v.minLength(1)) }),
		async run({ data }): Promise<{ output: GetCompanyOutput }> {
			try {
				const entry = inBatch(context, data.companyId);
				if (!entry) return { output: notInBatch(data.companyId) };
				const company = await context.crm.getCompany(data.companyId);
				if (!company.ok) return { output: { ok: false, error: company.error } };
				const deals = await context.crm.getDeals(company.data.dealIds);
				if (!deals.ok) return { output: { ok: false, error: deals.error } };
				const p = company.data.properties;
				return {
					output: {
						ok: true,
						company: {
							id: company.data.id,
							name: p.name ?? null,
							domain: p.domain ?? null,
							website: p.domain ? `https://${p.domain.replace(/^https?:\/\//, '')}` : null,
							industry: p.industry ?? null,
							employees: p.numberofemployees ? Number(p.numberofemployees) : null,
							country: p.country ?? null,
							lifecycleStage: p.lifecyclestage ?? null,
							description: p.description ?? null,
							ownerId: p.hubspot_owner_id ?? null,
							lastWebsiteVisit: iso(p.hs_analytics_last_visit_timestamp),
							lastConversion: iso(p.recent_conversion_date),
							lastConversionEvent: p.recent_conversion_event_name ?? null,
							lastContacted: iso(p.notes_last_contacted),
							lastSalesActivity: iso(p.hs_last_sales_activity_timestamp),
							doNotProspect: isTrue(p.do_not_prospect),
							contactCount: company.data.contactIds.length,
						},
						selection: { score: entry.score, signals: entry.signals },
						openDeals: deals.data
							.filter((deal) => !isTrue(deal.properties.hs_is_closed))
							.map((deal) => ({
								id: deal.id,
								name: deal.properties.dealname ?? null,
								stage: deal.properties.dealstage ?? null,
								pipeline: deal.properties.pipeline ?? null,
								created: iso(deal.properties.createdate),
								lastModified: iso(deal.properties.hs_lastmodifieddate),
							})),
					},
				};
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}

const contactOutcomeSchema = v.object({
	contactId: v.pipe(v.string(), v.minLength(1)),
	email: v.pipe(v.string(), v.minLength(1)),
	status: v.picklist(['sent', 'drafted', 'uncertain', 'skipped']),
	note: v.optional(v.string()),
});

export function recordCompanyOutcome(context: RunContext) {
	return defineTool({
		name: 'record_company_outcome',
		description:
			'Record what this run did for one selected company: a note on the company with the outcome, ' +
			'contacts, and research sources; a follow-up task for the owner when an email was sent, or a ' +
			'find-a-contact task when the company was skipped with nobody to email; and the company\'s ' +
			'last-prospected date. Call exactly once per company, after sending or deciding to skip.',
		input: v.object({
			companyId: v.pipe(v.string(), v.minLength(1)),
			status: v.picklist(['sent', 'drafted', 'skipped']),
			summary: v.pipe(v.string(), v.minLength(1), v.maxLength(2_000)),
			contacts: v.array(contactOutcomeSchema),
			sources: v.array(v.pipe(v.string(), v.minLength(1))),
			skipReason: v.optional(v.string()),
		}),
		async run({ data, log }): Promise<{ output: RecordOutcomeOutput }> {
			try {
				const entry = inBatch(context, data.companyId);
				if (!entry) return { output: notInBatch(data.companyId) };
				// The ledger, not the model, says what actually happened per contact.
				const contacts = data.contacts.map((contact) => ({
					...contact,
					status: context.ledger.has(contact.contactId)?.status ?? 'skipped',
				}));
				const anySent = contacts.some((contact) => contact.status === 'sent');
				const anyUncertain = contacts.some((contact) => contact.status === 'uncertain');
				const now = context.now();
				const body = [
					`<strong>Prospecting agent — ${context.runDate}</strong>`,
					`Outcome: ${anySent ? 'sent' : data.status}${anyUncertain ? ' (one or more sends uncertain — check the contact timeline before following up)' : ''}`,
					...(data.skipReason ? [`Skip reason: ${data.skipReason}`] : []),
					``,
					data.summary,
					``,
					`Selected because (score ${entry.score}): ${entry.signals.map((signal) => `${signal.signal} (+${signal.weight}: ${signal.detail})`).join('; ') || 'n/a'}`,
					...(contacts.length > 0
						? [``, `Contacts:`, ...contacts.map((contact) => `• ${contact.email} — ${contact.status}${contact.note ? `: ${contact.note}` : ''}`)]
						: []),
					...(data.sources.length > 0 ? [``, `Sources:`, ...data.sources.map((source) => `• ${source}`)] : []),
				].join('<br>');
				const note = await context.crm.createNote({ companyId: data.companyId }, body, now);
				if (!note.ok) return { output: { ok: false, error: note.error } };

				let taskId: string | null = null;
				const needsFollowUp = anySent || anyUncertain;
				// A skip with no contacts at all means the agent found nobody to
				// email and couldn't create anyone — that's a human's job now.
				const noContactSkip = !needsFollowUp && data.status === 'skipped' && contacts.length === 0;
				if (needsFollowUp || noContactSkip) {
					const company = await context.crm.getCompany(data.companyId);
					const ownerId = company.ok ? company.data.properties.hubspot_owner_id ?? undefined : undefined;
					const dueAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
					const task = await context.crm.createTask(
						data.companyId,
						needsFollowUp
							? {
									subject: `Follow up: prospecting outreach to ${entry.name} (${context.runDate})`,
									body: `The prospecting agent emailed ${contacts.filter((c) => c.status !== 'skipped').map((c) => c.email).join(', ')} on ${context.runDate}. Check for a reply and follow up.`,
									ownerId,
									dueAt,
								}
							: {
									subject: `Find a contact: prospecting agent found nobody to email at ${entry.name} (${context.runDate})`,
									body:
										`${entry.name} scored ${entry.score} on buying signals but has no eligible contact in HubSpot, and research found no named person to add.` +
										`${data.skipReason ? ` ${data.skipReason}` : ''} See the company note from ${context.runDate} for what was tried.`,
									ownerId,
									dueAt,
								},
					);
					if (!task.ok) {
						log.warn(needsFollowUp ? 'follow-up task not created' : 'find-a-contact task not created', { companyId: data.companyId, error: task.error });
					} else {
						taskId = task.data.id;
					}
				}

				const marked = await context.crm.markProspected(data.companyId, now);
				if (!marked.ok) {
					log.warn('last_prospected_at not set', { companyId: data.companyId, error: marked.error });
				}
				log.info('company outcome recorded', { companyId: data.companyId, status: anySent ? 'sent' : data.status });
				return {
					output: {
						ok: true,
						noteId: note.data.id,
						taskId,
						markedProspected: marked.ok,
						contacts: contacts.map((contact) => ({ contactId: contact.contactId, status: contact.status })),
					},
				};
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}
