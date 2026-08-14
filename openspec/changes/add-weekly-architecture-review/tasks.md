## 1. Setup and configuration

- [x] 1.1 No new runtime dependency — the trigger is a platform-provided Cloudflare Cron Trigger. (Superseded: an earlier pass added `croner` for the node target, removed when the project moved to `target: 'cloudflare'`.)
- [x] 1.2 Add the new variables to `.env.example` with comments: `ARCH_REVIEW_ENABLED`, `ARCH_REVIEW_LABEL` (default `architecture-review`), `ARCH_REVIEW_REPO` (optional, defaults to `GITHUB_REPO`), plus a note that the cadence lives in `wrangler.jsonc` and that the review reads repository contents with the existing `GITHUB_TOKEN`.
- [x] 1.3 Add a small config helper (in `src/review/config.ts`, imported by the schedule and the tools, which also need the label and repo resolvers) that reads the `ARCH_REVIEW_*` variables, applies defaults, and throws a clear error on invalid values.

## 2. Read-only repository inspection tools

- [x] 2.1 Create `src/tools/repo-inspect.ts` (importing the Octokit client from `src/channels/github-client.ts`, not the webhook channel) with a `reviewRepo()` resolver mirroring `targetRepo()` in `src/tools/github-issues.ts` — reads `ARCH_REVIEW_REPO` and falls back to `GITHUB_REPO`, accepting `owner/repo` or a github.com URL — and the shared `errorOutput()` shape (`{ ok: false, error }`).
- [x] 2.2 Implement `list_repo_files`: resolves the default branch, calls `client.rest.git.getTree` recursively, accepts an optional path prefix filter, returns `{ ok: true, files: [{ path, size }], truncated }` capped at ~400 entries.
- [x] 2.3 Implement `read_repo_file`: `client.rest.repos.getContent` for one path, base64-decoded to UTF-8, returned with 1-based line numbers, capped at ~2,000 lines / 64 KB with a `truncated` flag; refuse paths matching secret-shaped names (`.env`, `.env.*`, `*.pem`, `id_rsa*`) with `ok: false`.
- [x] 2.4 Implement `list_recent_architecture_reports`: `client.rest.issues.listForRepo` on the tracker repo filtered by `ARCH_REVIEW_LABEL`, `state: 'all'`, newest first, limit ~5, returning number, title, state, URL, and a body excerpt.
- [x] 2.5 Make every tool return `{ ok: false, error }` instead of throwing, matching the convention in `src/tools/github-issues.ts`.

## 3. Report filing tool

- [x] 3.1 Create `src/tools/architecture-report.ts` with `fileArchitectureReportIssue(context)` defining `file_architecture_report_issue`; input: `focusArea`, `summary`, and `findings` — 3–7 items of `{ kind: 'improvement' | 'hardening' | 'tech-debt', title, severity: 'low' | 'medium' | 'high', evidence, recommendation }` — validated with valibot (`v.minLength`/`v.maxLength` on the array).
- [x] 3.2 Render the issue body: focus area, run date, summary, then findings sorted by severity as sections carrying kind, severity, evidence, and recommendation; append a footer noting it was produced by the weekly architecture review.
- [x] 3.3 Create the issue via `client.rest.issues.create` on `GITHUB_REPO` with title `Architecture review: <focus area> (<YYYY-MM-DD>)` and `labels: [ARCH_REVIEW_LABEL]`; on a labelling-attributable failure, retry once without labels and return `labelled: false`.
- [x] 3.4 Return `{ ok: true, issueNumber, url, labelled }` on success and `{ ok: false, error }` on failure; never throw.

## 4. Architecture review agent

- [x] 4.1 Create `src/agents/architecture-review.ts` as a `'use agent'` module exporting `ArchitectureReview`, with a valibot `initialData` schema of `{ focusAreaId, focusAreaTitle, focusAreaBrief, runDate, scheduledAt }` (optional overall, so the agent still runs standalone via `flue run`).
- [x] 4.2 Set the model with `useModel('openrouter/anthropic/claude-opus-5')` (same model as the first-party id, routed through the key the project already uses) and bind the four tools with `useTool(...)`: the three inspection tools and the report-filing tool.
- [x] 4.3 Write the system prompt: review only the given focus area; list the tree once, read at most ~15 relevant files, check the last ~5 review issues; report 3–7 findings ranked by severity, each with a `path:line` evidence citation and a proposed next step; drop candidate findings that cannot be evidenced; reference an open prior finding instead of restating it; call `file_architecture_report_issue` exactly once at the end; never modify code or existing issues; on `ok: false` report the error plainly and never claim the issue was filed.
- [x] 4.4 Define the focus-area catalogue (id, title, and a short brief naming the files/concerns in scope) in a module both the agent and the schedule import, ordered: ingress & channel security, agent design & prompts, outbound tools & external calls, persistence & durability, configuration & secrets, dependencies & build, observability & operability, scheduled & background work.

## 5. Weekly schedule

- [x] 5.1 Add `"triggers": { "crons": ["0 9 * * 5"] }` to `wrangler.jsonc` (Friday 09:00, UTC — Cloudflare has no timezone option) and append the agent's Durable Object migration entry `flue-class-FlueArchitectureReviewAgent`.
- [x] 5.2 Implement deterministic focus selection: compute a continuous Monday-based week index for the fire date in the configured timezone and pick `FOCUS_AREAS[weekIndex % FOCUS_AREAS.length]` (a continuous index rather than the 1–53 ISO week number, which resets each January and would skip a slot once a year); keep this in a pure exported function so it is testable without firing the cron.
- [x] 5.3 Create `src/schedules/architecture-review.ts` exporting `dispatchArchitectureReview(firedAt)`: skip when `ARCH_REVIEW_ENABLED` is off, derive `runDate` (`YYYY-MM-DD`, UTC) and `dispatch(ArchitectureReview, { id: \`arch-review-${runDate}\`, idempotencyKey: \`arch-review-${runDate}\`, initialData: {...}, message: { kind: 'signal', type: 'schedule', body: <review instruction naming the focus area>, attributes: { focusArea, runDate, scheduledAt } } })`, and log the dispatched run.
- [x] 5.4 Add a `scheduled(controller)` handler to the default export of `src/cloudflare.ts` that awaits `dispatchArchitectureReview(new Date(controller.scheduledTime))` (with a comment explaining that the review agent is dispatch-only and intentionally has no mounted route; `fetch` stays in `app.ts`).

## 6. Verification

- [x] 6.1 Run `npm run check:types` and fix any type errors.
- [x] 6.2 Verify focus rotation without the cron: call the selection function for eight consecutive weeks (UTC) and confirm it walks the catalogue in order and is stable for a repeated week.
- [ ] 6.3 With `GITHUB_REPO`/`ARCH_REVIEW_REPO` pointed at a sandbox repository, trigger one run (`wrangler dev --test-scheduled` against `/__scheduled`, or call `dispatchArchitectureReview` directly) and confirm: the run dispatches, the agent reads real files, and exactly one labelled issue is filed with evidenced findings.
- [ ] 6.4 Confirm idempotency: fire again for the same `runDate` and verify no second run and no second issue (Cloudflare delivers scheduled events at-least-once).
- [ ] 6.5 Confirm failure handling: run once with an invalid `GITHUB_TOKEN` and verify the failed tool result appears in the conversation and the agent does not claim success.
- [x] 6.6 Confirm disablement and config validation: `ARCH_REVIEW_ENABLED=false` makes a fire a no-op, and a non-boolean value raises an error naming the variable.
- [x] 6.7 Run `npm run build` and confirm the emitted `dist/**/wrangler.json` carries `triggers.crons`, the bundled Worker's default export has a `scheduled` handler, and the bundle exports exactly the agent classes the migrations declare.
- [ ] 6.8 Point `GITHUB_REPO`/`ARCH_REVIEW_REPO` back at their real values after the sandbox run.

## 7. Documentation

- [x] 7.1 Add a "Weekly architecture review" section to `README.md`: what it does, when it fires, how the focus rotates, the required token scopes, how to change the cadence (`wrangler.jsonc`), and how to disable it.
- [x] 7.2 Note in the README that scheduled delivery is at-least-once (the date-keyed conversation ID and idempotency key absorb a duplicate fire) and that local `npm run dev` does not fire cron triggers, so a local run means calling the dispatch directly.
