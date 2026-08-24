import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { hunterApiKey, hunterMinScore } from '../prospecting/config.ts';
import { emailDomain, normalizeDomain } from '../prospecting/crm.ts';
import { HunterClient, type FoundEmail } from '../prospecting/hunter.ts';
import { inBatch, type RunContext } from '../prospecting/run-context.ts';

// Provider email lookups for contact discovery. The domain is always the
// selected company's own (never model input), every call is charged to the
// per-company lookup budget, and only on-domain personal addresses at or
// above the score threshold are recorded as verified — the registry that
// create_contact trusts is written here, in code, and nowhere else.

type ToolError = { ok: false; error: string };
type LookupOutput =
	| ToolError
	| {
			ok: true;
			domain: string;
			results: { email: string; firstName: string | null; lastName: string | null; title: string | null; score: number; type: string; verified: boolean }[];
			remainingLookups: number;
	  };

const NAME = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80));

export function findContactEmail(context: RunContext, client?: HunterClient) {
	return defineTool({
		name: 'find_contact_email',
		description:
			'Look up email addresses for a selected company through the licensed email-finder provider. Give ' +
			'firstName and lastName (e.g. from a search-result snippet) to find that person\'s address, or omit ' +
			'them to list people the provider knows at the company\'s domain. Only results marked verified may be ' +
			'used with create_contact. Charged to the company\'s lookup budget; each call costs real credits.',
		input: v.object({
			companyId: v.pipe(v.string(), v.minLength(1)),
			firstName: v.optional(NAME),
			lastName: v.optional(NAME),
		}),
		async run({ data, log }): Promise<{ output: LookupOutput }> {
			const entry = inBatch(context, data.companyId);
			if (!entry) {
				return { output: { ok: false, error: `Company ${data.companyId} is not in this run's batch` } };
			}
			const domain = normalizeDomain(entry.domain);
			if (!domain) {
				return { output: { ok: false, error: `Company ${entry.name} has no domain to look up` } };
			}
			if ((data.firstName === undefined) !== (data.lastName === undefined)) {
				return { output: { ok: false, error: 'Provide both firstName and lastName, or neither' } };
			}
			if (!context.research.takeLookupAttempt(data.companyId)) {
				return { output: { ok: false, error: `Lookup attempt cap reached for company ${data.companyId} — the provider may be down; stop retrying and proceed with what you have.` } };
			}
			if (!context.research.take(data.companyId, 'lookups')) {
				return { output: { ok: false, error: `Lookup budget spent for company ${data.companyId}. Proceed with what you have.` } };
			}
			const key = hunterApiKey();
			if (!key && !client) {
				context.research.refund(data.companyId, 'lookups');
				return { output: { ok: false, error: 'Email lookups are not configured (HUNTER_API_KEY unset)' } };
			}
			const hunter = client ?? new HunterClient(key as string);
			const lookup =
				data.firstName !== undefined && data.lastName !== undefined
					? await hunter.emailFinder(domain, data.firstName, data.lastName).then((r) => (r.ok ? { ok: true as const, data: r.data ? [r.data] : [] } : r))
					: await hunter.domainSearch(domain);
			if (!lookup.ok) {
				// A provider failure shouldn't cost credits the run never spent.
				context.research.refund(data.companyId, 'lookups');
				return { output: lookup };
			}
			const minScore = hunterMinScore();
			const results = lookup.data.map((found: FoundEmail) => {
				const onDomain = emailDomain(found.email) === domain || (emailDomain(found.email) ?? '').endsWith(`.${domain}`);
				const verified = onDomain && found.type === 'personal' && found.score >= minScore;
				if (verified) {
					context.verifiedEmails.set(found.email, {
						firstName: found.firstName,
						lastName: found.lastName,
						title: found.title,
						score: found.score,
						source: 'hunter',
					});
					log.info('provider-verified email recorded', { companyId: data.companyId, score: found.score });
				}
				return { ...found, verified };
			});
			return {
				output: {
					ok: true,
					domain,
					results,
					remainingLookups: context.research.remaining(data.companyId).lookups,
				},
			};
		},
	});
}
