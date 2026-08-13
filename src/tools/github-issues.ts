import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { client } from '../channels/github-client.ts';

/** Where the report came from in Slack; absent when the agent runs standalone. */
export interface SlackSourceRef {
	channelId: string;
	threadTs: string;
	startedBy?: string;
}

// The repository is fixed by configuration — the model never chooses the
// owner/repo it writes to. Accepts "owner/repo" or a github.com URL.
export function targetRepo(): { owner: string; repo: string } {
	const configured = (process.env.GITHUB_REPO ?? '')
		.replace(/^https?:\/\/(www\.)?github\.com\//, '')
		.replace(/\.git$/, '')
		.replace(/\/+$/, '');
	const [owner, repo, ...rest] = configured.split('/');
	if (!owner || !repo || rest.length > 0) {
		throw new Error('GITHUB_REPO must be set to "owner/repo" or a github.com repository URL');
	}
	return { owner, repo };
}

// Label that opts an issue into the coding-agent pipeline (see
// channels/github.ts, which dispatches on the matching `issues.labeled` event).
export function codingAgentLabel(): string {
	return process.env.CODING_AGENT_LABEL || 'agent-fix';
}

function slackBacklink(ref: SlackSourceRef): string {
	const permalink = `https://slack.com/archives/${ref.channelId}/p${ref.threadTs.replace('.', '')}`;
	const reporter = ref.startedBy ? ` by <@${ref.startedBy}>` : '';
	return `Reported${reporter} in Slack: ${permalink}`;
}

function errorOutput(error: unknown): { ok: false; error: string } {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function fileGithubIssue(ref?: SlackSourceRef) {
	return defineTool({
		name: 'file_github_issue',
		description:
			'File a new GitHub issue for this bug report in the configured repository. ' +
			'Call this exactly once per conversation; reuse the returned issueNumber for follow-ups. ' +
			'Set handOffToCodingAgent: true to label the issue for the automated coding agent, ' +
			'which will attempt a fix and open a pull request.',
		input: v.object({
			title: v.pipe(v.string(), v.minLength(1)),
			summary: v.pipe(v.string(), v.minLength(1)),
			severity: v.picklist(['low', 'medium', 'high', 'critical']),
			affectedArea: v.pipe(v.string(), v.minLength(1)),
			details: v.optional(v.string()),
			handOffToCodingAgent: v.optional(v.boolean()),
		}),
		async run({ data }) {
			try {
				const { owner, repo } = targetRepo();
				const body = [
					`## Summary`,
					data.summary,
					``,
					`**Severity:** ${data.severity}`,
					`**Affected area:** ${data.affectedArea}`,
					...(data.details ? [``, `## Details`, data.details] : []),
					...(ref ? [``, `---`, slackBacklink(ref)] : []),
				].join('\n');
				const result = await client.rest.issues.create({
					owner,
					repo,
					title: data.title,
					body,
				});
				const created = { issueNumber: result.data.number, url: result.data.html_url };
				if (!data.handOffToCodingAgent) {
					return { output: { ok: true, ...created } };
				}
				// Applied as a separate call after creation so GitHub emits a
				// distinct `issues.labeled` delivery for the coding-agent webhook.
				// A labeling failure must not void the filing: the issue exists,
				// so report both facts instead of a bare error.
				try {
					await client.rest.issues.addLabels({
						owner,
						repo,
						issue_number: result.data.number,
						labels: [codingAgentLabel()],
					});
					return { output: { ok: true, ...created, handedOffToCodingAgent: true } };
				} catch (labelError) {
					return {
						output: {
							ok: true,
							...created,
							handedOffToCodingAgent: false,
							handOffError: errorOutput(labelError).error,
						},
					};
				}
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}

export function commentOnGithubIssue() {
	return defineTool({
		name: 'comment_on_github_issue',
		description:
			'Append a follow-up comment to the GitHub issue already filed for this conversation. ' +
			'Use the issueNumber returned by file_github_issue earlier in this conversation.',
		input: v.object({
			issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
			body: v.pipe(v.string(), v.minLength(1)),
		}),
		async run({ data }) {
			try {
				const { owner, repo } = targetRepo();
				const result = await client.rest.issues.createComment({
					owner,
					repo,
					issue_number: data.issueNumber,
					body: data.body,
				});
				return {
					output: { ok: true, commentId: result.data.id, url: result.data.html_url },
				};
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}
