import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { lintMessage } from '../prospecting/lint.ts';
import { inBatch, type RunContext } from '../prospecting/run-context.ts';
import { eligibleContactsFor } from './hubspot-contacts.ts';

// The one irreversible action in the run. Everything that must be true
// before an email leaves is checked here, in order, regardless of what the
// prompt said: the contact belongs to a selected company and is still
// eligible; the recipient is the CRM record's address; the message passes
// the messaging rules and cites evidence from this run; the per-run ledger
// has not seen this contact; and sending is switched on and under the cap.
// Anything short of that becomes a draft note on the contact — never a send.

type SendOutput =
	| { ok: false; error: string; problems?: string[] }
	| { ok: true; sent: true; contactId: string; to: string; sentThisRun: number }
	| { ok: true; sent: false; reason: 'outreach-disabled' | 'daily-cap'; contactId: string; draftNoteId: string }
	| { ok: false; uncertain: true; contactId: string; error: string };

function draftNote(context: RunContext, subject: string, body: string, reason: string): string {
	return [
		`<strong>Draft outreach (${context.runDate})</strong> — not sent: ${reason}`,
		``,
		`<strong>Subject:</strong> ${subject}`,
		``,
		body.replace(/\n/g, '<br>'),
	].join('<br>');
}

export function sendOutreachEmail(context: RunContext) {
	return defineTool({
		name: 'send_outreach_email',
		description:
			'Send one personalized email to an eligible contact through HubSpot (logged on their timeline), or ' +
			'store it as a draft note when sending is disabled or the daily cap is reached. Plain-text body, no ' +
			'signature beyond a first name, no unsubscribe line. `evidence` must list the URLs you fetched this run ' +
			'and/or hubspot:<property> references that back the specific claims in the message. One call per ' +
			'contact, ever: a second call is refused, and a failed or uncertain send must NOT be retried.',
		input: v.object({
			companyId: v.pipe(v.string(), v.minLength(1)),
			contactId: v.pipe(v.string(), v.minLength(1)),
			subject: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
			body: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4_000)),
			evidence: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.maxLength(10)),
		}),
		async run({ data, log }): Promise<{ output: SendOutput }> {
			const company = inBatch(context, data.companyId);
			if (!company) return { output: { ok: false, error: `Company ${data.companyId} is not in this run's batch` } };

			const prior = context.ledger.has(data.contactId);
			if (prior) {
				return { output: { ok: false, error: `Contact ${data.contactId} was already handled this run (${prior.status}); never send twice` } };
			}

			const problems = lintMessage(data, context.knowledge.messaging, context.fetchedUrls);
			if (problems.length > 0) {
				return { output: { ok: false, error: 'Message rejected by the messaging rules; revise and call again', problems } };
			}

			// Eligibility is re-derived from the CRM at send time, not trusted
			// from the earlier listing, and the recipient address comes from the
			// record — the model never supplies one.
			const record = await context.crm.getCompany(data.companyId);
			if (!record.ok) return { output: { ok: false, error: record.error } };
			const evaluation = await eligibleContactsFor(context, record.data);
			if (!evaluation.ok) return { output: { ok: false, error: evaluation.error } };
			const contact = evaluation.data.eligible.find((candidate) => candidate.id === data.contactId);
			if (!contact) {
				const excluded = evaluation.data.excluded.find((candidate) => candidate.id === data.contactId);
				return {
					output: {
						ok: false,
						error: excluded
							? `Contact ${data.contactId} is not eligible (${excluded.reason}); it cannot be emailed`
							: `Contact ${data.contactId} is not associated with company ${data.companyId}`,
					},
				};
			}

			const now = context.now();
			context.ledger.reserve(data.contactId, now);
			context.save?.();

			const holdReason = !context.settings.outreachEnabled
				? ('outreach-disabled' as const)
				: context.ledger.capReached
					? ('daily-cap' as const)
					: undefined;
			if (holdReason) {
				const note = await context.crm.createNote(
					{ contactId: data.contactId },
					draftNote(context, data.subject, data.body, holdReason === 'outreach-disabled' ? 'OUTREACH_ENABLED is off' : `daily cap of ${context.settings.dailyCap} reached`),
					now,
				);
				if (!note.ok) {
					context.ledger.release(data.contactId);
				context.save?.();
					return { output: { ok: false, error: `Could not store the draft note: ${note.error}` } };
				}
				context.ledger.settle(data.contactId, 'drafted');
				context.save?.();
				log.info('outreach drafted, not sent', { contactId: data.contactId, reason: holdReason });
				return { output: { ok: true, sent: false, reason: holdReason, contactId: data.contactId, draftNoteId: note.data.id } };
			}

			const result = await context.crm.sendSingleEmail({
				emailId: context.settings.templateId(),
				to: contact.email,
				from: context.settings.senderEmail,
				contactId: data.contactId,
				subject: data.subject,
				body: data.body,
			});
			if (!result.ok) {
				if (result.uncertain) {
					// It may have gone out. The reservation stays so no retry is
					// possible this run; the summary flags it for a human.
					log.warn('outreach send outcome unknown', { contactId: data.contactId, error: result.error });
					return { output: { ok: false, uncertain: true, contactId: data.contactId, error: `Send outcome unknown (${result.error}); do NOT retry` } };
				}
				context.ledger.release(data.contactId);
				context.save?.();
				return { output: { ok: false, error: result.error } };
			}
			context.ledger.settle(data.contactId, 'sent');
			context.save?.();
			log.info('outreach email sent', { contactId: data.contactId, to: contact.email, company: company.name });
			return { output: { ok: true, sent: true, contactId: data.contactId, to: contact.email, sentThisRun: context.ledger.sent } };
		},
	});
}
