// flue-blueprint: channel/github@1
import { createGitHubChannel } from '@flue/github';
import { dispatch, init } from '@flue/runtime';
import { Coding } from '../agents/coding.ts';
import { codingAgentLabel, targetRepo } from '../tools/github-issues.ts';

export { client } from './github-client.ts';

// Inbound webhook ingress: GitHub posts to /channels/github/webhook. The only
// issue events this app reacts to are the coding-agent label being applied or
// removed in the configured repository. Applying opts into coding work;
// removing cancels stale work and establishes a clean retry boundary. The
// label normally comes from triage, but a hand-applied label works identically.
export const channel = createGitHubChannel({
	webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,

	async webhook({ delivery }) {
		if (delivery.name !== 'issues') return;
		if (delivery.payload.action !== 'labeled' && delivery.payload.action !== 'unlabeled') return;
		if (delivery.payload.label?.name !== codingAgentLabel()) return;

		const { owner, repo } = targetRepo();
		const repository = delivery.payload.repository;
		if (repository.owner.login !== owner || repository.name !== repo) return;

		const issue = delivery.payload.issue;
		const ref = { owner, repo, issueNumber: issue.number };
		const instanceId = channel.instanceId(ref);

		// Removing the opt-in label is also the cancellation/retry boundary. Without
		// this, re-adding the label merely joins or queues behind a stuck response.
		if (delivery.payload.action === 'unlabeled') {
			await init(Coding, { id: instanceId }).abort();
			return;
		}
		if (delivery.payload.action !== 'labeled') return;

		await dispatch(Coding, {
			// One conversation per issue. Removing and re-adding the label first
			// aborts stale work; redeliveries are dropped by the delivery id.
			id: instanceId,
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
