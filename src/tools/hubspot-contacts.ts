import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { evaluateContacts, type EligibleContact } from '../prospecting/contacts.ts';
import { emailDomain, isTrue, normalizeDomain, type CompanyRecord } from '../prospecting/crm.ts';
import { canonicalUrl } from '../prospecting/web.ts';
import { inBatch, type RunContext } from '../prospecting/run-context.ts';

// Who at a selected company may be emailed. The exclusions live in
// prospecting/contacts.ts and are applied here before the model sees a
// single name; the send tool runs the same check again at send time.

type ToolError = { ok: false; error: string };

type ListOutput =
	| ToolError
	| {
			ok: true;
			companyDomain: string | null;
			contacts: ReturnType<typeof present>[];
			moreEligible: number;
			excludedByReason: Record<string, number>;
			discovery: string | null;
	  };
type CreateOutput = ToolError | { ok: true; contactId: string; email: string };

function errorOutput(error: unknown): ToolError {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function present(contact: EligibleContact) {
	return {
		contactId: contact.id,
		email: contact.email,
		firstName: contact.firstName,
		lastName: contact.lastName,
		title: contact.title,
		lastInboundActivity: contact.lastInboundMs ? new Date(contact.lastInboundMs).toISOString() : null,
		agentCreated: contact.agentCreated,
	};
}

/** Shared by list_eligible_contacts and the send tool's re-check. */
export async function eligibleContactsFor(context: RunContext, company: CompanyRecord) {
	const contacts = await context.crm.getContacts(company.contactIds);
	if (!contacts.ok) return contacts;
	return {
		ok: true as const,
		data: evaluateContacts(contacts.data, {
			icp: context.knowledge.icp,
			companyDomain: company.properties.domain ?? undefined,
			companyDoNotProspect: isTrue(company.properties.do_not_prospect),
			cooldownDays: context.settings.cooldownDays,
			now: context.now(),
		}),
	};
}

export function listEligibleContacts(context: RunContext) {
	return defineTool({
		name: 'list_eligible_contacts',
		description:
			'List the contacts at a selected company who may be emailed, best match first, up to the per-company ' +
			'limit. Unsubscribed, bounced, do-not-contact, off-domain, and recently-emailed contacts are already ' +
			'removed and cannot be sent to. Also reports how many were excluded and why.',
		input: v.object({ companyId: v.pipe(v.string(), v.minLength(1)) }),
		async run({ data }): Promise<{ output: ListOutput }> {
			try {
				if (!inBatch(context, data.companyId)) {
					return { output: { ok: false, error: `Company ${data.companyId} is not in this run's batch` } };
				}
				const company = await context.crm.getCompany(data.companyId);
				if (!company.ok) return { output: { ok: false, error: company.error } };
				const evaluation = await eligibleContactsFor(context, company.data);
				if (!evaluation.ok) return { output: { ok: false, error: evaluation.error } };
				const excludedByReason: Record<string, number> = {};
				for (const excluded of evaluation.data.excluded) {
					excludedByReason[excluded.reason] = (excludedByReason[excluded.reason] ?? 0) + 1;
				}
				// The bonus is decided here, in code, off the same evaluation the
				// send tool re-runs — the model cannot ask for more budget.
				let discovery: string | null = null;
				if (evaluation.data.eligible.length === 0) {
					context.research.grantDiscoveryBonus(data.companyId);
					context.save?.();
					discovery =
						'No eligible contacts: discovery research budget granted. Research the company site (team/about/staff/leadership/contact pages) and search for a named person in a target persona with an email on the company domain, then create_contact if you find one.';
				}
				return {
					output: {
						ok: true,
						companyDomain: normalizeDomain(company.data.properties.domain) ?? null,
						contacts: evaluation.data.eligible.slice(0, context.settings.contactsPerCompany).map(present),
						moreEligible: Math.max(0, evaluation.data.eligible.length - context.settings.contactsPerCompany),
						excludedByReason,
						discovery,
					},
				};
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}

const NAME = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80));

export function createContact(context: RunContext) {
	return defineTool({
		name: 'create_contact',
		description:
			'Create a contact at a selected company when research found a named person and no existing contact ' +
			'matches a target persona. The email must be on the company\'s domain and either found on a page you ' +
			'fetched this run (pass sourceUrl) or verified by find_contact_email this run. The contact is marked ' +
			'as agent-created.',
		input: v.object({
			companyId: v.pipe(v.string(), v.minLength(1)),
			firstName: NAME,
			lastName: NAME,
			email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
			title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
			sourceUrl: v.optional(v.pipe(v.string(), v.url())),
		}),
		async run({ data, log }): Promise<{ output: CreateOutput }> {
			try {
				if (!inBatch(context, data.companyId)) {
					return { output: { ok: false, error: `Company ${data.companyId} is not in this run's batch` } };
				}
				// Two evidence paths, both code-owned: the email appeared on a
				// page fetched this run, or the provider verified it this run.
				const providerRecord = context.verifiedEmails.get(data.email);
				if (providerRecord) {
					const same = (a: string | null, b: string) => !a || a.trim().toLowerCase() === b.trim().toLowerCase();
					if (!same(providerRecord.firstName, data.firstName) || !same(providerRecord.lastName, data.lastName)) {
						return {
							output: {
								ok: false,
								error: `Name does not match the provider's record for ${data.email} ("${providerRecord.firstName ?? ''} ${providerRecord.lastName ?? ''}"). Use the provider's name or do not create the contact.`,
							},
						};
					}
				} else if (!data.sourceUrl) {
					return { output: { ok: false, error: `${data.email} is not provider-verified this run and no sourceUrl was given; only people from fetched pages or verified lookups can be added` } };
				} else if (!context.fetchedUrls.has(canonicalUrl(data.sourceUrl))) {
					return { output: { ok: false, error: `sourceUrl ${data.sourceUrl} was not fetched this run; only people found on fetched pages can be added` } };
				}
				const company = await context.crm.getCompany(data.companyId);
				if (!company.ok) return { output: { ok: false, error: company.error } };
				if (isTrue(company.data.properties.do_not_prospect)) {
					return { output: { ok: false, error: 'Company is marked do-not-prospect' } };
				}
				const companyDomain = normalizeDomain(company.data.properties.domain);
				const domain = emailDomain(data.email);
				if (!companyDomain || !domain || (domain !== companyDomain && !domain.endsWith(`.${companyDomain}`))) {
					return { output: { ok: false, error: `Email domain "${domain}" does not match the company domain "${companyDomain}"` } };
				}
				if (context.knowledge.icp.excludedDomains.includes(domain)) {
					return { output: { ok: false, error: `Domain "${domain}" is excluded by the ICP` } };
				}
				const created = await context.crm.createContact(data.companyId, {
					email: data.email,
					firstname: data.firstName,
					lastname: data.lastName,
					jobtitle: data.title,
					agent_created: 'true',
					agent_created_run: context.runDate,
				});
				if (!created.ok) {
					// 409 = a contact with this email already exists (possibly at
					// another company); the agent must not email it on this one.
					if (created.status === 409) {
						return { output: { ok: false, error: `A contact with ${data.email} already exists in HubSpot; it was not eligible for this company` } };
					}
					return { output: { ok: false, error: created.error } };
				}
				log.info('contact created by prospecting agent', {
					companyId: data.companyId,
					contactId: created.data.id,
					evidence: providerRecord ? `provider:${providerRecord.source}` : 'fetched-page',
				});
				return { output: { ok: true, contactId: created.data.id, email: data.email } };
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}
