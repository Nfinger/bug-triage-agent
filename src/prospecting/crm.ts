import { hubspot, type HubspotClient, type HubspotResult } from '../channels/hubspot-client.ts';

/**
 * Typed reads and the few bounded writes the prospecting run makes against
 * HubSpot. Scoring, contact selection, and the agent tools all go through
 * here, so the list of properties read and the kinds of object written are
 * in one place. Nothing in this module deletes, merges, reassigns, or touches
 * deals.
 */

export const COMPANY_PROPERTIES = [
	'name',
	'domain',
	'industry',
	'numberofemployees',
	'country',
	'state',
	'lifecyclestage',
	'hubspot_owner_id',
	'hs_analytics_last_visit_timestamp',
	'hs_analytics_num_visits',
	'recent_conversion_date',
	'recent_conversion_event_name',
	'notes_last_contacted',
	'hs_last_sales_activity_timestamp',
	'hs_date_entered_lead',
	'hs_date_entered_marketingqualifiedlead',
	'hs_date_entered_salesqualifiedlead',
	'hs_date_entered_opportunity',
	'hs_date_entered_customer',
	'description',
	'last_prospected_at',
	'do_not_prospect',
] as const;

export const CONTACT_PROPERTIES = [
	'email',
	'firstname',
	'lastname',
	'jobtitle',
	'hs_email_optout',
	'hs_marketable_status',
	'hs_email_bounce',
	'hs_email_hard_bounce_reason_enum',
	'hs_email_last_send_date',
	'notes_last_contacted',
	'hs_last_sales_activity_timestamp',
	'hs_analytics_last_visit_timestamp',
	'recent_conversion_date',
	'createdate',
	'lifecyclestage',
	'do_not_contact',
	'agent_created',
	'agent_created_run',
] as const;

export const DEAL_PROPERTIES = ['dealname', 'dealstage', 'pipeline', 'closedate', 'createdate', 'hs_is_closed_won', 'hs_is_closed', 'hs_lastmodifieddate', 'amount'] as const;

// HubSpot-defined association type ids (see "Association type ID values").
const ASSOCIATION = {
	noteToCompany: 190,
	noteToContact: 202,
	taskToCompany: 192,
	contactToCompany: 279,
} as const;

type Properties = Record<string, string | null | undefined>;

export interface CrmObject {
	id: string;
	properties: Properties;
}

export interface CompanyRecord extends CrmObject {
	contactIds: string[];
	dealIds: string[];
}

interface RawObject {
	id: string;
	properties: Properties;
	associations?: Record<string, { results: { id: string; type: string }[] }>;
}

interface Page<T> {
	results: T[];
	paging?: { next?: { after: string } };
}

function association(raw: RawObject, name: string): string[] {
	const results = raw.associations?.[name]?.results ?? [];
	return [...new Set(results.map((entry) => entry.id))];
}

export class Crm {
	private readonly client: HubspotClient;

	constructor(client: HubspotClient = hubspot()) {
		this.client = client;
	}

	async getCompany(id: string): Promise<HubspotResult<CompanyRecord>> {
		const result = await this.client.call<RawObject>({
			method: 'GET',
			path: `/crm/v3/objects/companies/${encodeURIComponent(id)}`,
			query: { properties: COMPANY_PROPERTIES.join(','), associations: 'contacts,deals' },
		});
		if (!result.ok) return result;
		return {
			ok: true,
			data: {
				id: result.data.id,
				properties: result.data.properties,
				contactIds: association(result.data, 'contacts'),
				dealIds: association(result.data, 'deals'),
			},
		};
	}

	/**
	 * Companies modified recently enough to carry a signal, oldest-first by
	 * id for stable paging. Bounded by `maxPages` × 100.
	 */
	async searchActiveCompanies(sinceMs: number, maxPages: number): Promise<HubspotResult<CompanyRecord[]>> {
		const companies: CompanyRecord[] = [];
		let after: string | undefined;
		for (let page = 0; page < maxPages; page++) {
			const result = await this.client.call<Page<RawObject>>({
				method: 'POST',
				path: '/crm/v3/objects/companies/search',
				body: {
					filterGroups: [
						{
							filters: [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(sinceMs) }],
						},
					],
					properties: COMPANY_PROPERTIES,
					sorts: [{ propertyName: 'hs_object_id', direction: 'ASCENDING' }],
					limit: 100,
					after,
				},
			});
			if (!result.ok) return result;
			for (const raw of result.data.results) {
				companies.push({ id: raw.id, properties: raw.properties, contactIds: [], dealIds: [] });
			}
			after = result.data.paging?.next?.after;
			if (!after) break;
		}
		return { ok: true, data: companies };
	}

	/** Find one company by exact domain match; null when none exists. */
	async findCompanyByDomain(domain: string): Promise<HubspotResult<CompanyRecord | null>> {
		const result = await this.client.call<Page<RawObject>>({
			method: 'POST',
			path: '/crm/v3/objects/companies/search',
			body: {
				filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
				properties: COMPANY_PROPERTIES,
				limit: 1,
			},
		});
		if (!result.ok) return result;
		const raw = result.data.results[0];
		return { ok: true, data: raw ? { id: raw.id, properties: raw.properties, contactIds: [], dealIds: [] } : null };
	}

	/** Remove the cooldown stamp so the next selection may pick the company again. */
	async clearProspected(companyId: string): Promise<HubspotResult<unknown>> {
		return this.client.call({
			method: 'PATCH',
			path: `/crm/v3/objects/companies/${encodeURIComponent(companyId)}`,
			// An empty string clears a HubSpot property.
			body: { properties: { last_prospected_at: '' } },
		});
	}

	private async batchRead(objectType: 'contacts' | 'deals', ids: string[], properties: readonly string[]): Promise<HubspotResult<CrmObject[]>> {
		if (ids.length === 0) return { ok: true, data: [] };
		const objects: CrmObject[] = [];
		for (let start = 0; start < ids.length; start += 100) {
			const result = await this.client.call<Page<RawObject>>({
				method: 'POST',
				path: `/crm/v3/objects/${objectType}/batch/read`,
				body: { properties, inputs: ids.slice(start, start + 100).map((id) => ({ id })) },
			});
			if (!result.ok) return result;
			objects.push(...result.data.results.map((raw) => ({ id: raw.id, properties: raw.properties })));
		}
		return { ok: true, data: objects };
	}

	getContacts(ids: string[]): Promise<HubspotResult<CrmObject[]>> {
		return this.batchRead('contacts', ids, CONTACT_PROPERTIES);
	}

	getDeals(ids: string[]): Promise<HubspotResult<CrmObject[]>> {
		return this.batchRead('deals', ids, DEAL_PROPERTIES);
	}

	/** Associated contact and deal ids for many companies at once. */
	async getAssociations(
		companyIds: string[],
		toObject: 'contacts' | 'deals',
	): Promise<HubspotResult<Map<string, string[]>>> {
		const map = new Map<string, string[]>();
		for (let start = 0; start < companyIds.length; start += 100) {
			const result = await this.client.call<{ results: { from: { id: string }; to: { toObjectId: number }[] }[] }>({
				method: 'POST',
				path: `/crm/v4/associations/companies/${toObject}/batch/read`,
				body: { inputs: companyIds.slice(start, start + 100).map((id) => ({ id })) },
			});
			if (!result.ok) return result;
			for (const entry of result.data.results) {
				map.set(entry.from.id, entry.to.map((to) => String(to.toObjectId)));
			}
		}
		return { ok: true, data: map };
	}

	async createContact(
		companyId: string,
		properties: { email: string; firstname: string; lastname: string; jobtitle?: string; agent_created: string; agent_created_run: string },
	): Promise<HubspotResult<{ id: string }>> {
		return this.client.call<{ id: string }>({
			method: 'POST',
			path: '/crm/v3/objects/contacts',
			body: {
				properties,
				associations: [
					{
						to: { id: companyId },
						types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.contactToCompany }],
					},
				],
			},
		});
	}

	async createNote(target: { companyId?: string; contactId?: string }, body: string, at: Date): Promise<HubspotResult<{ id: string }>> {
		const associations = [];
		if (target.companyId) {
			associations.push({
				to: { id: target.companyId },
				types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.noteToCompany }],
			});
		}
		if (target.contactId) {
			associations.push({
				to: { id: target.contactId },
				types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.noteToContact }],
			});
		}
		return this.client.call<{ id: string }>({
			method: 'POST',
			path: '/crm/v3/objects/notes',
			body: { properties: { hs_timestamp: at.toISOString(), hs_note_body: body }, associations },
		});
	}

	async createTask(
		companyId: string,
		task: { subject: string; body: string; ownerId?: string; dueAt: Date },
	): Promise<HubspotResult<{ id: string }>> {
		return this.client.call<{ id: string }>({
			method: 'POST',
			path: '/crm/v3/objects/tasks',
			body: {
				properties: {
					hs_timestamp: task.dueAt.toISOString(),
					hs_task_subject: task.subject,
					hs_task_body: task.body,
					hs_task_status: 'NOT_STARTED',
					hs_task_priority: 'MEDIUM',
					hs_task_type: 'TODO',
					...(task.ownerId ? { hubspot_owner_id: task.ownerId } : {}),
				},
				associations: [
					{
						to: { id: companyId },
						types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOCIATION.taskToCompany }],
					},
				],
			},
		});
	}

	/** The only company property the run ever sets. */
	async markProspected(companyId: string, at: Date): Promise<HubspotResult<unknown>> {
		return this.client.call({
			method: 'PATCH',
			path: `/crm/v3/objects/companies/${encodeURIComponent(companyId)}`,
			// Date properties take a midnight-UTC epoch in ms.
			body: { properties: { last_prospected_at: String(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())) } },
		});
	}

	async sendSingleEmail(input: {
		emailId: number;
		to: string;
		from: string;
		contactId: string;
		subject: string;
		body: string;
	}): Promise<HubspotResult<{ statusId?: string; requestedAt?: string }>> {
		return this.client.call({
			method: 'POST',
			path: '/marketing/v3/transactional/single-email/send',
			body: {
				emailId: input.emailId,
				message: { to: input.to, from: input.from },
				contactProperties: {},
				// The template renders {{ custom.subject }} / {{ custom.body }}.
				customProperties: { subject: input.subject, body: input.body },
			},
		});
	}

	/** Property existence check for the custom properties the run depends on. */
	async hasProperty(objectType: 'companies' | 'contacts', name: string): Promise<HubspotResult<boolean>> {
		const result = await this.client.call<{ name: string }>({
			method: 'GET',
			path: `/crm/v3/properties/${objectType}/${encodeURIComponent(name)}`,
		});
		if (result.ok) return { ok: true, data: true };
		if (result.status === 404) return { ok: true, data: false };
		return result;
	}
}

/** Custom properties created by scripts/setup-hubspot-properties.mjs. */
export const CUSTOM_PROPERTIES = {
	companies: ['last_prospected_at', 'do_not_prospect'],
	contacts: ['do_not_contact', 'agent_created', 'agent_created_run'],
} as const;

/** Fail fast when the portal is missing a property the run writes or filters on. */
export async function assertCustomProperties(crm: Crm): Promise<void> {
	const missing: string[] = [];
	for (const [objectType, names] of Object.entries(CUSTOM_PROPERTIES) as ['companies' | 'contacts', readonly string[]][]) {
		for (const name of names) {
			const result = await crm.hasProperty(objectType, name);
			if (!result.ok) throw new Error(`Could not check HubSpot property ${objectType}.${name}: ${result.error}`);
			if (!result.data) missing.push(`${objectType}.${name}`);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`HubSpot portal is missing custom properties ${missing.join(', ')} — run scripts/setup-hubspot-properties.mjs first`,
		);
	}
}

export function isTrue(value: string | null | undefined): boolean {
	return value === 'true' || value === '1';
}

export function timestampMs(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	const numeric = Number(value);
	if (Number.isFinite(numeric) && numeric > 0) return numeric;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function emailDomain(email: string | null | undefined): string | undefined {
	const at = email?.lastIndexOf('@') ?? -1;
	return at > 0 ? email!.slice(at + 1).toLowerCase() : undefined;
}

export function normalizeDomain(domain: string | null | undefined): string | undefined {
	if (!domain) return undefined;
	const bare = domain
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.replace(/\/.*$/, '');
	return bare || undefined;
}
