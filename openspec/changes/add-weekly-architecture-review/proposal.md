# Add Weekly Architecture Review Agent

## Why

Nothing in this project looks at the system as a whole on a cadence: architecture drift, hardening gaps, and technical debt only surface when something breaks or when a human happens to notice. The app already knows how to read a codebase's tracker and file issues (the bug-triage flow), so a scheduled agent that reviews one aspect of the system each week and files its findings as a GitHub issue turns "we should look at that someday" into a standing, tracked item in the same place the team already works.

## What Changes

- Add a weekly Cloudflare Cron Trigger (`"triggers": { "crons": ["0 9 * * 5"] }` in `wrangler.jsonc`, Friday 09:00 UTC) handled by a `scheduled()` export in `src/cloudflare.ts`, which calls a dispatch module (`src/schedules/architecture-review.ts`) that sends a signal to a new architecture-review agent.
- Add an `ArchitectureReview` agent (`src/agents/architecture-review.ts`) that reviews **one** focus area of the system per run — a deterministic rotation over a fixed list of areas (ingress/channel security, agent design, outbound tools, persistence, configuration & secrets, dependencies & build, observability, scheduled workloads) so coverage rotates instead of the model re-reviewing whatever it happens to look at first.
- Add read-only repository inspection tools (`src/tools/repo-inspect.ts`) — list the repo tree, read a file's contents, and list recent architecture-review issues — built on the existing authenticated Octokit client, so the agent reviews the real code and can avoid repeating findings from prior weeks.
- Add a report-filing tool (`src/tools/architecture-report.ts`) that files exactly one GitHub issue per weekly run, titled and labelled so reports are findable, with the report body carrying the focus area, findings (improvement / hardening / technical debt), each with severity, evidence (`path:line` references), and a proposed next step.
- Declare the agent's Durable Object class in `wrangler.jsonc` migrations (`flue-class-FlueArchitectureReviewAgent`, append-only). No HTTP route is mounted — the agent is dispatch-only, reachable from the cron and nothing else.
- Add configuration: `ARCH_REVIEW_ENABLED`, `ARCH_REVIEW_LABEL`, and optional `ARCH_REVIEW_REPO` (the repo under review, defaulting to `GITHUB_REPO`); reuses the existing `GITHUB_TOKEN` / `GITHUB_REPO`, and the existing `OPENROUTER_API_KEY` for the review model. When it fires is deploy configuration, not an environment variable — Cloudflare reads the cron from `wrangler.jsonc` and evaluates it in UTC.
- Document the new variables in `.env.example` and the flow in `README.md`. No new runtime dependency — the trigger is platform-provided.

## Capabilities

### New Capabilities

- `architecture-review-schedule`: A weekly Friday trigger that dispatches exactly one architecture-review run per week to a per-run agent conversation, with a configurable cron expression and timezone, overlap protection, and dispatch failures that are logged rather than swallowed.
- `architecture-review-agent`: Agent-side handling of a scheduled review — a deterministic rotating focus area per run, read-only inspection of the repository under review, awareness of prior reports so findings are not repeated verbatim, and a structured report of improvements, hardening opportunities, and technical debt with severity and evidence.
- `architecture-report-filing`: Filing the weekly report as a GitHub issue in the configured repository — exactly one issue per weekly run, labelled and titled for discoverability, with filing failures surfaced in the conversation rather than dropped.

### Modified Capabilities

_None — the existing `slack-channel`, `bug-report-intake`, and `github-issue-filing` requirements are unchanged. The new agent uses its own tools and its own filing path; the bug-triage tools (`file_github_issue`, `comment_on_github_issue`) are untouched._

## Impact

- **New dependencies**: none — the Cron Trigger is provided by the platform.
- **New code**: `src/agents/architecture-review.ts`, `src/schedules/architecture-review.ts`, `src/tools/repo-inspect.ts`, `src/tools/architecture-report.ts`.
- **Modified code**: `src/app.ts` (import the schedule module for its registration side effect), `.env.example`, `README.md`.
- **External systems**: The existing `GITHUB_TOKEN` needs read access to the repository under review in addition to issue-write on the tracker; the review adds a weekly write to the issue tracker (one issue per Friday) and repo-content reads. Model spend increases by roughly one long-context agent run per week.
- **Operational**: Cloudflare delivers scheduled events at-least-once; the date-keyed conversation ID and idempotency key make a duplicate fire a no-op. Local `npm run dev` does not fire cron triggers, so a local run means calling the dispatch function directly. No breaking changes; a fire can be made a no-op with `ARCH_REVIEW_ENABLED=false`.
