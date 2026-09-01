import type { MessagingRules } from './knowledge.ts';
import { canonicalUrl } from './web.ts';

/**
 * Message linting from docs/business/messaging.md, enforced by the send tool
 * rather than the prompt. Returns every problem at once so the model can fix
 * the message in one revision.
 */

export interface MessageDraft {
	subject: string;
	body: string;
	/** URLs fetched this run or `hubspot:<property>` references. */
	evidence: string[];
}

function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

export function lintMessage(draft: MessageDraft, rules: MessagingRules, fetchedUrls: ReadonlySet<string>): string[] {
	const problems: string[] = [];
	const subjectWords = wordCount(draft.subject);
	if (subjectWords === 0) problems.push('subject is empty');
	if (subjectWords > rules.maxSubjectWords) problems.push(`subject is ${subjectWords} words; max ${rules.maxSubjectWords}`);
	const bodyWords = wordCount(draft.body);
	if (bodyWords < 10) problems.push('body is too short to be a real message');
	if (bodyWords > rules.maxWords) problems.push(`body is ${bodyWords} words; max ${rules.maxWords}`);
	const haystack = `${draft.subject}\n${draft.body}`.toLowerCase();
	for (const phrase of rules.bannedPhrases) {
		if (haystack.includes(phrase.toLowerCase())) problems.push(`contains banned phrase "${phrase}"`);
	}
	if (/[!！]/.test(`${draft.subject}\n${draft.body}`)) problems.push('do not use exclamation marks');
	if (/—/.test(`${draft.subject}\n${draft.body}`)) problems.push('do not use em dashes');
	if (/<[a-z][^>]*>/i.test(draft.body)) problems.push('body must be plain text, not HTML');
	if (/unsubscribe/i.test(draft.body)) problems.push('do not write an unsubscribe line; the template adds it');
	if (draft.evidence.length === 0) {
		problems.push('evidence is empty: cite at least one URL fetched this run or a hubspot:<property> reference');
	}
	for (const item of draft.evidence) {
		if (item.startsWith('hubspot:')) {
			if (item.length <= 'hubspot:'.length) problems.push(`evidence "${item}" names no property`);
			continue;
		}
		if (!fetchedUrls.has(canonicalUrl(item))) problems.push(`evidence "${item}" was not fetched this run; fetch it first or drop the claim`);
	}
	return problems;
}
