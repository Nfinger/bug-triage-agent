# Design: Add Weekly Architecture Review Agent

## Context

The app is a Flue project on the `cloudflare` target: `src/app.ts` is the Hono entrypoint, `src/cloudflare.ts` carries the Worker's non-HTTP exports (the Sandbox Durable Object, and now the `scheduled()` handler), agents live in `src/agents/`, conversations are durable Durable Objects declared as append-only migrations in `wrangler.jsonc`, and outbound GitHub access goes through one authenticated Octokit client (`src/channels/github-client.ts`, kept separate from the webhook channel so tools do not pull in the agent graph) wrapped in `defineTool()` tools (`src/tools/github-issues.ts`). Today every agent run is reactive: a Slack message arrives or a GitHub label is applied, a channel dispatches, an agent acts.

Flue has no built-in scheduler. The documented pattern ([Schedules](https://flueframework.com/docs/guide/schedules/)) is a trigger + a `dispatch()` + a conversation id: on the node target, an in-process cron library (`croner`) in module scope; on Cloudflare, a `scheduled()` handler driven by `wrangler.jsonc` cron triggers. A dispatch-only agent needs no HTTP mount — nothing outside the app should be able to start a review.

The review agent also needs to *see* the system it reviews. A Worker has no filesystem and no source checkout at all, so reading the working directory is not an option; the repository content is reachable through the same Octokit client already configured for issue filing.

## Goals / Non-Goals

**Goals:**
- One architecture review per week, every Friday, on a cron expression declared in `wrangler.jsonc` (UTC).
- Each run covers exactly one focus area, rotating deterministically week over week so coverage spreads across the system instead of clustering.
- The agent reviews the real code (read-only) and the record of prior reviews before writing anything.
- Each run produces exactly one GitHub issue containing a structured report: focus area, and findings classified as improvement / hardening / technical debt, each with severity, evidence (`path:line`), and a proposed next step.
- Failures (dispatch, repo read, issue filing) are observable — logged or recorded in the conversation — never silently dropped.

**Non-Goals:**
- Catch-up or backfill for a week that produced no report (the exported dispatch function makes a manual run possible; nothing does it automatically).
- Opening pull requests, editing code, or auto-applying any of the proposed improvements.
- Posting the report to Slack, or closing/triaging prior review issues.
- Reviewing repositories other than the single configured one, or multi-repo aggregation.
- A general-purpose scheduling framework — this change adds one schedule, not a schedule registry.
- Running the review on the node target (an in-process `croner` schedule; the project moved to Cloudflare, and that trigger cannot fire in a Worker).

## Decisions

### 1. Cloudflare Cron Trigger, handled in `src/cloudflare.ts`
`wrangler.jsonc` declares `"triggers": { "crons": ["0 9 * * 5"] }`, and the `scheduled()` handler on the default export of `src/cloudflare.ts` calls `dispatchArchitectureReview()` in `src/schedules/architecture-review.ts`. This is the pattern the Flue docs prescribe for the Cloudflare target, and the `@flue/vite` plugin composes that default export into the Worker entry (it rejects a `fetch` there — HTTP stays in `app.ts`). Keeping the dispatch in its own module keeps `cloudflare.ts` thin and leaves the trigger swappable.

**Alternatives considered**: (a) an in-process `croner` schedule in module scope — the node-target pattern, and what this change originally implemented; it cannot work here, because a Worker has no long-lived process for a module-scope timer to run in; (b) an external scheduler POSTing to a token-protected route — adds an authenticated public route to an app whose review agent is deliberately unreachable over HTTP.

### 2. Friday cadence in `wrangler.jsonc`, evaluated in UTC
`0 9 * * 5` is Friday 09:00; day-of-week 5 is Friday in standard five-field cron. Cloudflare evaluates cron expressions in **UTC only** — there is no timezone option — so the cadence lives in deploy configuration rather than in an environment variable, and the run's date and rotation are derived in UTC to match. `ARCH_REVIEW_ENABLED=false` makes a fire a no-op without removing the trigger.

**Alternative considered**: `ARCH_REVIEW_CRON` / `ARCH_REVIEW_TIMEZONE` environment variables — meaningless on this target: Cloudflare reads the schedule from deploy config, not from the Worker's environment, and would ignore a timezone anyway.

### 3. One conversation per fire, keyed by the fire's date
Dispatch uses `id: \`arch-review-${YYYY-MM-DD}\`` (the fire date in the configured timezone) with `idempotencyKey` set to the same string. A fresh conversation per week keeps context bounded — the agent's context is the code it reads this week, not eight weeks of prior transcripts — and the date-keyed idempotency key means a double fire (process restart inside the minute, a manual re-trigger) cannot produce a second review or a second issue for that week. Continuity across weeks comes from the repository itself, not from conversation history: the agent reads prior review issues through a tool (Decision 5).

**Alternative considered**: a fixed id (`'architecture-review'`) so the agent accumulates memory of past reviews — rejected because context grows without bound and the useful history (what was already reported) is better read from the tracker, where humans also edit and close it.

### 4. Deterministic focus rotation computed at dispatch, not chosen by the model
The schedule holds an ordered `FOCUS_AREAS` list — ingress & channel security, agent design & prompts, outbound tools & external calls, persistence & durability, configuration & secrets, dependencies & build, observability & operability, scheduled & background work — and selects `FOCUS_AREAS[weekIndex % FOCUS_AREAS.length]`, where `weekIndex` is a continuous count of Monday-based weeks since the epoch evaluated in the configured timezone. (A continuous index rather than the 1–53 ISO week *number*: the number resets each January, which would skip a slot in the rotation once a year.) The chosen area travels in `initialData` and in the signal's `attributes`, so the conversation records which aspect it was asked to review, and the prompt instructs the agent to stay inside it.

Deterministic selection makes the system's coverage a property of the code rather than of model temperature, makes "what will next week cover?" answerable without running anything, and makes the agent's behaviour reproducible in tests. Rotation over roughly two months also means each area is revisited with fresh code, which is the point of a standing review.

**Alternative considered**: letting the agent pick the area from what looks worst — rejected as unstable (models converge on the same salient areas) and unverifiable.

### 5. Read-only repository inspection through the existing Octokit client
`src/tools/repo-inspect.ts` defines three tools bound to the agent:
- `list_repo_files` — `git.getTree` (recursive) on the default branch of the repo under review, returning paths and sizes, capped (≈400 entries) and filterable by path prefix.
- `read_repo_file` — `repos.getContent` for one path, decoded to UTF-8, returned with line numbers so findings can cite `path:line`; capped (≈2,000 lines / 64 KB, truncation flagged in the result); refuses paths matching `.env*` and other secret-shaped names as a defence in depth.
- `list_recent_architecture_reports` — `issues.listForRepo` filtered by the review label, newest first, returning number, title, URL, and a body excerpt.

Reading through the API works identically in dev, in a container, and on a host with no checkout, and reuses the credential and error-handling conventions already in the repo. "Read-only" is a property of the tool surface (only read endpoints are exposed), not of the token.

**Alternatives considered**: (a) filesystem reads — impossible in a Worker, which has no filesystem and ships as a single bundle without sources; (b) a Flue sandbox with a checkout — heavier than this project needs and unnecessary for reading a handful of files.

### 6. A dedicated filing tool, leaving the bug-triage tools untouched
`file_architecture_report_issue` (`src/tools/architecture-report.ts`) takes the focus area and a list of findings — each `{ kind: improvement | hardening | tech-debt, title, severity: low|medium|high, evidence, recommendation }` — plus a short overall summary, and renders them into one issue body. Title format: `Architecture review: <focus area> (<YYYY-MM-DD>)`. It applies `ARCH_REVIEW_LABEL` (default `architecture-review`), which is what `list_recent_architecture_reports` filters on.

Reusing `file_github_issue` was rejected: its input is bug-shaped (`severity`, `affectedArea`, one report per Slack thread) and its description tells the model it is for bug reports. A separate tool keeps both prompts honest and lets the report body carry a findings table.

The tool follows the existing conventions in `src/tools/github-issues.ts`: repository resolved from configuration (never from the model), `{ ok: true, … }` / `{ ok: false, error }` outputs, and no throwing into the runtime. Filing failures therefore land in the conversation, and the prompt forbids claiming success on `ok: false`.

### 7. Exactly one issue per weekly run, enforced at two levels
Dispatch idempotency (Decision 3) prevents a second *run* for a given Friday. Within the run, the prompt states the tool is called exactly once, and the tool's description repeats it — the same belt-and-braces the bug-triage agent already uses. If a filing attempt returns `ok: false`, the agent reports the failure rather than retrying blindly into a possible duplicate.

### 8. Labels applied at creation, with a fallback
`issues.create` accepts `labels`, creating the label on first use. If the create call fails in a way attributable to labelling (e.g. the token lacks label permission on the target repo), the tool retries once without labels and reports `labelled: false` in its output, so a permissions gap degrades discoverability instead of losing the week's report.

### 9. Bounded review budget in the prompt
The agent is instructed to: read the focus area's brief, list the tree once, read at most ~15 files relevant to the area, check the last ~5 review issues, and report 3–7 findings ranked by severity — no exhaustive audits, no findings without evidence, no repeats of an open prior finding (reference it instead). This keeps a weekly run to a predictable token cost and keeps issues readable enough that someone actually acts on them.

### 10. Model: a strong reasoning model for the review
`useModel('openrouter/anthropic/claude-opus-5')`. Architecture review over long file contents is the depth-sensitive part of this app, unlike bug summarization; a weekly cadence makes the cost negligible (~52 runs/year). Routing it through OpenRouter keeps the project on a single provider key (`OPENROUTER_API_KEY`), the same one the bug-triage agent already uses.

**Alternative considered**: the model's first-party `anthropic/claude-opus-5` id — same model, but it would add a second provider key to configure, rotate, and set as a Worker secret for no behavioural gain.

### 11. Configuration
- `ARCH_REVIEW_ENABLED` — `false` makes a scheduled fire a no-op (default enabled).
- `ARCH_REVIEW_LABEL` — issue label, default `architecture-review`.
- `ARCH_REVIEW_REPO` — `owner/repo` under review; defaults to `GITHUB_REPO`, so a team whose tracker and codebase are the same repo sets nothing.
- Reuses `GITHUB_TOKEN` (now needs contents-read on the reviewed repo in addition to issues-write on the tracker) and `GITHUB_REPO`.

Invalid configuration (a non-boolean enablement flag, a malformed repository) throws where it is read rather than being silently ignored. The cadence itself is validated by wrangler at deploy time.

## Risks / Trade-offs

- [Cloudflare delivers scheduled events at-least-once, so a fire can arrive twice] → Conversation ID and idempotency key are both the fire's date (Decision 3), so a duplicate delivery is a no-op rather than a second run and a second issue.
- [A deployed cron is invisible until it fires — a missing `triggers.crons` entry or a `scheduled()` handler the plugin didn't pick up fails silently for a week] → Verification asserts the built `dist/**/wrangler.json` carries `triggers.crons` and that the bundled Worker's default export has a `scheduled` handler; the dispatch also logs the conversation it dispatched.
- [A new agent needs an append-only Durable Object migration; forgetting it breaks the deploy] → `flue-class-FlueArchitectureReviewAgent` is appended to `wrangler.jsonc` migrations, and the built bundle is checked to export exactly the declared classes.
- [Local `npm run dev` does not fire cron triggers, so the path is easy to leave untested] → The dispatch is an exported function (`dispatchArchitectureReview`) that can be called directly, which is also the backfill path for a week that produced no report.
- [A weekly agent-authored issue becomes noise nobody reads] → Bounded to 3–7 evidenced findings ranked by severity, one focus area per week, prior findings referenced rather than repeated; the label makes the stream easy to filter or mute.
- [The model invents findings or cites files it never read] → Every finding must carry `path:line` evidence obtained through `read_repo_file`; the prompt forbids findings without evidence. Reports are advisory input for humans, and nothing acts on them automatically.
- [Repo reads blow up context or hit secondary rate limits on a large repo] → Hard caps in the tools (tree entries, lines/bytes per file, truncation flag) plus the prompt's ~15-file budget.
- [Shared `GITHUB_TOKEN` is broader than the review needs] → Only read endpoints are exposed as tools, secret-shaped paths are refused, and the deployment note recommends a fine-grained token scoped to contents-read plus issues-write.
- [Filing failure loses the week's work] → The failure is recorded in the conversation with the error text and no success is claimed; the run's findings remain in the conversation, and the next Friday's run covers a different area regardless.
- [The dev server registers the cron too, filing issues from a laptop] → `ARCH_REVIEW_ENABLED=false` in `.env.example`'s local guidance; the default cron is Friday-only, so an accidental fire needs both a Friday and a running dev server.

## Migration Plan

Additive — no data changes and no breaking changes, but it does add one append-only Durable Object migration (`flue-class-FlueArchitectureReviewAgent`) and one Cron Trigger to the Worker's deploy configuration.

Rollout order: set the review secrets (`ARCH_REVIEW_*` as needed) with `wrangler secret put` → deploy → verify against a sandbox `GITHUB_REPO`, either by waiting for the Friday fire or by dispatching a run by hand, that one issue is filed with the correct label, title, and evidenced findings → point `GITHUB_REPO`/`ARCH_REVIEW_REPO` at the real repositories.

Rollback: set `ARCH_REVIEW_ENABLED=false` (a fire becomes a no-op, no redeploy of code needed), or remove the `triggers.crons` entry and redeploy. Reverting the change entirely is also safe — nothing else in the app depends on it — but the migration entry must stay in `wrangler.jsonc`, since wrangler validates migration history against the local file rather than live state. Issues already filed are ordinary issues and can be closed or bulk-deleted by label.

## Open Questions

- Which repository is actually under review — the tracker repo (`GITHUB_REPO`) or a separate product repo (`ARCH_REVIEW_REPO`)? Defaults assume the same repo.
- Is `anthropic/claude-opus-5` (a second provider key) acceptable, or should the review run on the existing OpenRouter key to keep configuration to one provider?
- Should the weekly report also be posted to the Slack bug channel (or a dedicated engineering channel) once outbound Slack posting exists? Out of scope here, but it is the natural next step.
- Should findings be filed as one issue per week (chosen) or one issue per finding so each is independently closeable? One-per-week keeps the tracker quiet; per-finding would make follow-through easier to measure.
- Should the focus rotation be seeded or offset so the first production run starts on a specific area, rather than wherever the ISO week number lands?
