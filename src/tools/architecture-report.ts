import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { client } from '../channels/github-client.ts';
import { reviewLabel, trackerRepo } from '../review/config.ts';

/** What the run is reviewing; supplied by the schedule, not by the model. */
export interface ReportContext {
	focusAreaTitle: string;
	runDate: string;
}

const KIND_LABELS = {
	improvement: 'Improvement',
	hardening: 'Hardening',
	'tech-debt': 'Technical debt',
} as const;

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

// Annotated because the tool has three exits (labelled, unlabelled, failed):
// without it the inferred union widens into optional-undefined members.
type FileReportOutput =
	| { ok: true; issueNumber: number; url: string; labelled: boolean }
	| { ok: false; error: string };

const findingSchema = v.object({
	kind: v.picklist(['improvement', 'hardening', 'tech-debt']),
	title: v.pipe(v.string(), v.minLength(1)),
	severity: v.picklist(['low', 'medium', 'high']),
	/** Concrete `path:line` references read during this run. */
	evidence: v.pipe(v.string(), v.minLength(1)),
	recommendation: v.pipe(v.string(), v.minLength(1)),
});

type Finding = v.InferOutput<typeof findingSchema>;

function issueBody(context: ReportContext, summary: string, findings: Finding[]): string {
	const ranked = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
	return [
		`**Focus area:** ${context.focusAreaTitle}`,
		`**Run date:** ${context.runDate}`,
		``,
		`## Summary`,
		summary,
		``,
		`## Findings`,
		...ranked.flatMap((finding, index) => [
			``,
			`### ${index + 1}. ${finding.title}`,
			`**Kind:** ${KIND_LABELS[finding.kind]} · **Severity:** ${finding.severity}`,
			``,
			`**Evidence:** ${finding.evidence}`,
			``,
			`**Proposed next step:** ${finding.recommendation}`,
		]),
		``,
		`---`,
		`Filed by the weekly architecture review. Advisory only — no code was changed.`,
	].join('\n');
}

// A 403 or 422 is a processed-and-rejected response, so no issue was created:
// retrying without labels cannot duplicate one. Anything else (network, 5xx)
// might have been applied, so it is reported rather than retried.
function isLabelRejection(error: unknown): boolean {
	const status = (error as { status?: number })?.status;
	return status === 403 || status === 422;
}

export function fileArchitectureReportIssue(context: ReportContext) {
	return defineTool({
		name: 'file_architecture_report_issue',
		description:
			'File this run\'s architecture review as a GitHub issue in the configured repository. ' +
			'Call this exactly once per run, at the end, with every finding you are reporting.',
		input: v.object({
			focusArea: v.pipe(v.string(), v.minLength(1)),
			summary: v.pipe(v.string(), v.minLength(1)),
			findings: v.pipe(v.array(findingSchema), v.minLength(3), v.maxLength(7)),
		}),
		async run({ data }): Promise<{ output: FileReportOutput }> {
			try {
				const { owner, repo } = trackerRepo();
				const title = `Architecture review: ${data.focusArea} (${context.runDate})`;
				const body = issueBody(context, data.summary, data.findings);
				try {
					const result = await client.rest.issues.create({
						owner,
						repo,
						title,
						body,
						labels: [reviewLabel()],
					});
					return {
						output: { ok: true, issueNumber: result.data.number, url: result.data.html_url, labelled: true },
					};
				} catch (error) {
					if (!isLabelRejection(error)) throw error;
					// Discoverability degrades, the week's report still lands.
					const result = await client.rest.issues.create({ owner, repo, title, body });
					return {
						output: { ok: true, issueNumber: result.data.number, url: result.data.html_url, labelled: false },
					};
				}
			} catch (error) {
				return { output: { ok: false, error: error instanceof Error ? error.message : String(error) } };
			}
		},
	});
}
