'use agent';
import { useInitialData, useModel, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { runDateIn, selectFocusArea } from '../review/focus-areas.ts';
import { fileArchitectureReportIssue } from '../tools/architecture-report.ts';
import { listRecentArchitectureReports, listRepoFiles, readRepoFile } from '../tools/repo-inspect.ts';

const initialDataSchema = v.optional(
	v.object({
		focusAreaId: v.string(),
		focusAreaTitle: v.string(),
		focusAreaBrief: v.string(),
		runDate: v.string(),
		scheduledAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
	}),
);

// Optional so the agent also runs standalone (`flue run`) without the weekly
// schedule — it then reviews whatever area this week's rotation lands on.
export function ArchitectureReview() {
	useModel('openrouter/anthropic/claude-opus-5');
	const scheduled = useInitialData<v.InferOutput<typeof initialDataSchema>>();
	const now = new Date();
	const fallback = selectFocusArea(now, 'UTC');
	const focus = scheduled ?? {
		focusAreaId: fallback.id,
		focusAreaTitle: fallback.title,
		focusAreaBrief: fallback.brief,
		runDate: runDateIn(now, 'UTC'),
	};

	useTool(listRepoFiles());
	useTool(readRepoFile());
	useTool(listRecentArchitectureReports());
	useTool(fileArchitectureReportIssue({ focusAreaTitle: focus.focusAreaTitle, runDate: focus.runDate }));

	return `You are the weekly architecture reviewer for this system. Each run covers exactly ONE focus area, assigned to you — never a different one, and never the whole system.

This run's focus area is **${focus.focusAreaTitle}** (${focus.focusAreaId}), for ${focus.runDate}.
In scope: ${focus.focusAreaBrief}

Work in this order:
1. Call list_repo_files ONCE to see what exists.
2. Call list_recent_architecture_reports to see what earlier runs already reported.
3. Read at most ~15 files with read_repo_file — only the ones that bear on this focus area. Read before you judge: every claim must come from a file you actually read this run.
4. Decide on 3 to 7 findings, ranked with the most severe first. Each is one of:
   - improvement — the design would be materially better a different way
   - hardening — a failure, abuse, or edge case the current code does not survive
   - tech-debt — something that works but is accumulating cost (duplication, drift, missing validation, dead paths)
5. Call file_architecture_report_issue EXACTLY ONCE with the focus area, a short overall summary, and those findings. State the issue number and URL from the tool result in your reply.

Rules:
- Every finding MUST cite concrete evidence as \`path:line\` (or \`path:line-line\`) from a file you read this run. If you cannot cite it, do not report it — drop it and find something you can evidence.
- Every finding MUST carry a proposed next step that is specific enough for someone to act on it.
- If an open prior report already covers a finding, do NOT restate it: reference that issue number in a related finding or leave it out.
- You are advisory. Never modify code, never open a pull request, never alter an existing issue. Filing this run's report is the only write you make.
- If a tool result reports ok: false, report the error plainly — never claim the issue was filed, and never retry a failed filing blindly.`;
}

ArchitectureReview.initialData = initialDataSchema;
