import { emailDomain, isTrue, normalizeDomain, timestampMs, type CrmObject } from './crm.ts';
import { personaMatchers, type Icp } from './knowledge.ts';

/**
 * Contact eligibility and ranking. Pure: the tool in tools/hubspot-contacts.ts
 * feeds it CRM records and hands the model only the survivors. Every
 * exclusion here is a hard rule — the model never sees an excluded contact,
 * and the send tool re-runs the same check before sending.
 */

export interface EligibilityOptions {
	icp: Icp;
	companyDomain: string | undefined;
	companyDoNotProspect: boolean;
	cooldownDays: number;
	now: Date;
}

export interface EligibleContact {
	id: string;
	email: string;
	firstName: string;
	lastName: string;
	title: string;
	/** Index of the matching persona pattern (lower = preferred). */
	personaRank: number;
	lastInboundMs: number | undefined;
	createdMs: number | undefined;
	agentCreated: boolean;
}

export type ExclusionReason =
	| 'company-do-not-prospect'
	| 'do-not-contact'
	| 'no-email'
	| 'unsubscribed'
	| 'hard-bounced'
	| 'foreign-domain'
	| 'excluded-domain'
	| 'recently-emailed'
	| 'no-persona-match';

export interface Evaluation {
	eligible: EligibleContact[];
	excluded: { id: string; email?: string; reason: ExclusionReason }[];
}

const SENIORITY = [/\b(chief|cpo|cto|ceo|coo|cdo)\b/i, /\b(vp|vice president|svp|evp)\b/i, /\bhead of\b/i, /\bdirector\b/i, /\blead\b/i, /\bmanager\b/i];

function seniority(title: string): number {
	const index = SENIORITY.findIndex((pattern) => pattern.test(title));
	return index === -1 ? SENIORITY.length : index;
}

/** Why a single contact may not be emailed, or undefined when it may. */
export function exclusionReason(contact: CrmObject, options: EligibilityOptions): ExclusionReason | undefined {
	const p = contact.properties;
	if (options.companyDoNotProspect) return 'company-do-not-prospect';
	if (isTrue(p.do_not_contact)) return 'do-not-contact';
	const email = p.email?.trim().toLowerCase();
	if (!email) return 'no-email';
	// Global opt-out. Per-subscription-type status is enforced again by HubSpot
	// at send time, which refuses unsubscribed recipients.
	if (isTrue(p.hs_email_optout)) return 'unsubscribed';
	if (p.hs_email_bounce && Number(p.hs_email_bounce) > 0) return 'hard-bounced';
	if (p.hs_email_hard_bounce_reason_enum) return 'hard-bounced';
	const domain = emailDomain(email);
	if (!domain) return 'no-email';
	if (options.icp.excludedDomains.some((excluded) => excluded.toLowerCase() === domain)) return 'excluded-domain';
	const companyDomain = normalizeDomain(options.companyDomain);
	if (!companyDomain || (domain !== companyDomain && !domain.endsWith(`.${companyDomain}`))) return 'foreign-domain';
	const cooldownMs = options.cooldownDays * 24 * 60 * 60 * 1000;
	const lastSent = timestampMs(p.hs_email_last_send_date);
	const lastContacted = timestampMs(p.notes_last_contacted);
	const mostRecent = Math.max(lastSent ?? 0, lastContacted ?? 0);
	if (mostRecent > 0 && options.now.getTime() - mostRecent < cooldownMs) return 'recently-emailed';
	return undefined;
}

/** Apply the hard exclusions and rank the survivors by persona fit. */
export function evaluateContacts(contacts: CrmObject[], options: EligibilityOptions): Evaluation {
	const matchers = personaMatchers(options.icp);
	const eligible: EligibleContact[] = [];
	const excluded: Evaluation['excluded'] = [];
	for (const contact of contacts) {
		const reason = exclusionReason(contact, options);
		const email = contact.properties.email?.trim().toLowerCase();
		if (reason) {
			excluded.push({ id: contact.id, email, reason });
			continue;
		}
		const title = contact.properties.jobtitle?.trim() ?? '';
		const personaRank = matchers.findIndex((pattern) => pattern.test(title));
		if (personaRank === -1) {
			excluded.push({ id: contact.id, email, reason: 'no-persona-match' });
			continue;
		}
		eligible.push({
			id: contact.id,
			email: email!,
			firstName: contact.properties.firstname?.trim() ?? '',
			lastName: contact.properties.lastname?.trim() ?? '',
			title,
			personaRank,
			lastInboundMs: Math.max(
				timestampMs(contact.properties.hs_analytics_last_visit_timestamp) ?? 0,
				timestampMs(contact.properties.recent_conversion_date) ?? 0,
			) || undefined,
			createdMs: timestampMs(contact.properties.createdate),
			agentCreated: isTrue(contact.properties.agent_created),
		});
	}
	// Recent inbound activity first, then persona order, then seniority, then newest.
	eligible.sort(
		(a, b) =>
			(b.lastInboundMs ?? 0) - (a.lastInboundMs ?? 0) ||
			a.personaRank - b.personaRank ||
			seniority(a.title) - seniority(b.title) ||
			(b.createdMs ?? 0) - (a.createdMs ?? 0),
	);
	return { eligible, excluded };
}
