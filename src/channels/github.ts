// flue-blueprint: channel/github@1
import { createGitHubChannel } from '@flue/github';
import { dispatch } from '@flue/runtime';
import { Coding } from '../agents/coding.ts';
import { codingAgentLabel, targetRepo } from '../tools/github-issues.ts';

export { client } from './github-client.ts';

// Inbound webhook ingress: GitHub posts to /channels/github/webhook. The only
// event this app reacts to is the coding-agent label being applied to an
// issue in the configured repository — that is the opt-in that starts a
// coding-agent conversation for the issue. The label normally comes from the
// bug-triage agent's hand-off, but a hand-applied label works identically.
export const channel = createGitHubChannel({
	webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,

	async webhook({ delivery }) {
		if (delivery.name !== 'issues' || delivery.payload.action !== 'labeled') return;
		if (delivery.payload.label?.name !== codingAgentLabel()) return;

		const { owner, repo } = targetRepo();
		const repository = delivery.payload.repository;
		if (repository.owner.login !== owner || repository.name !== repo) return;

		const issue = delivery.payload.issue;
		const ref = { owner, repo, issueNumber: issue.number };

		await dispatch(Coding, {
			// One conversation per issue: re-labeling converges on it instead of
			// starting parallel work. Redeliveries are dropped by the delivery id.
			id: channel.instanceId(ref),
			idempotencyKey: delivery.deliveryId,
			initialData: { ...ref, title: issue.title },
			message: {
				kind: 'signal',
				type: 'github.issue.labeled',
				body: issue.body ?? issue.title,
				attributes: {
					deliveryId: delivery.deliveryId,
					issueNumber: String(issue.number),
					issueUrl: issue.html_url,
					labeledBy: delivery.payload.sender?.login ?? 'unknown',
				},
			},
		});
	},
});
