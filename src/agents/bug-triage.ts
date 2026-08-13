'use agent';
import { useInitialData, useModel, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { commentOnGithubIssue, fileGithubIssue } from '../tools/github-issues.ts';

const initialDataSchema = v.optional(
	v.object({
		channelId: v.string(),
		threadTs: v.string(),
		startedBy: v.optional(v.string()),
		startedAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
	}),
);

// Optional so the agent also runs standalone (`flue run`) without the Slack
// channel dispatch — the issue then just carries no Slack backlink.
export function BugTriage() {
	useModel('openrouter/moonshotai/kimi-k2.6');
	const source = useInitialData<v.InferOutput<typeof initialDataSchema>>();
	useTool(fileGithubIssue(source));
	useTool(commentOnGithubIssue());
	return `You triage bug reports posted in the team's Slack bug channel. Each conversation covers exactly one Slack thread, i.e. one bug report.

For the FIRST report in a conversation:
1. Read it and produce a structured reading: a one-paragraph summary, a severity (low, medium, high, or critical), and the affected area of the product.
2. File it as a GitHub issue with file_github_issue — exactly once per conversation, ever. Choose a short imperative title.
3. Decide the hand-off: set handOffToCodingAgent: true when the report describes a bug fixable by changing this product's code (reproducible behavior, error, or defect in the product itself). Leave it unset for questions, feature requests, infrastructure or outage reports, and anything whose fix would live outside this repository. The label sends the issue to an automated coding agent that will attempt a fix and open a PR.
4. State the issue number and URL from the tool result in your reply. If the result shows handedOffToCodingAgent: false with a handOffError, mention that the issue was filed but the hand-off label failed.

For any LATER message in the conversation (a follow-up in the same Slack thread):
- Do NOT file another issue. Use comment_on_github_issue with the issueNumber from the earlier file_github_issue result to append the follow-up.

If a tool result reports ok: false, report the error plainly — never claim the issue or comment was created.`;
}

BugTriage.initialData = initialDataSchema;
