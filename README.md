# bug-triage-agent

A [Flue](https://flueframework.com) agent project that reads bug reports from a Slack channel, triages them with an agent, files each one as a GitHub issue — and, for code-fixable bugs, hands the issue to a coding agent that fixes it in an isolated Cloudflare sandbox and opens a pull request.

How it flows:

1. **Slack → issue**: Slack Events API → `POST /channels/slack/events` (signature-verified) → `src/channels/slack.ts` filters to plain user messages in the bug channel → dispatches to the `BugTriage` agent (one conversation per Slack thread, deduped on Slack's `event_id`) → the agent summarizes the report and calls `file_github_issue` / `comment_on_github_issue` (`src/tools/github-issues.ts`). When the report describes a code-fixable bug, triage sets `handOffToCodingAgent`, which applies the coding-agent label (`CODING_AGENT_LABEL`, default `agent-fix`) in a separate call after creation.
2. **Issue → PR**: GitHub webhook → `POST /channels/github/webhook` (signature-verified) → `src/channels/github.ts` reacts only to the coding-agent label being applied to an issue in `GITHUB_REPO` → dispatches the `Coding` agent (one conversation per issue, deduped on the webhook delivery id). The orchestrator (`src/agents/coding.ts`) clones the repo into a per-issue Cloudflare sandbox (`setup_workspace`), delegates investigation and implementation to its subagents (`src/agents/coding-workers.ts`: `investigator`, `code-writer`) working in the same sandbox, runs the project's checks, pushes the `agent/issue-<n>` branch, opens a PR (`Fixes #<n>`), and comments the PR link on the issue. Hand-applying the label to any issue triggers the same pipeline; PR review remains the human gate.

```
Slack bug channel → BugTriage agent → GitHub issue (+ agent-fix label)
                                            │
                              issues.labeled webhook
                                            ↓
                    Coding agent ⇄ investigator / code-writer subagents
                          │        (shared per-issue Cloudflare sandbox)
                          ↓
              branch + passing checks → pull request → comment on issue
```

Separately, a [weekly architecture review](#weekly-architecture-review) runs on a Friday cron: a scheduled agent reviews one aspect of the system and files its findings as a GitHub issue. And a [daily prospecting run](#daily-prospecting) turns HubSpot buying signals into researched, personalized outreach.

## Setup

```sh
npm install
```

The app deploys as a **Cloudflare Worker** (the coding agent's sandbox is a Cloudflare Containers Durable Object, which only exists inside a Worker). Local dev secrets go in `.dev.vars`; deployed secrets are set with `wrangler secret put`. Copy the variable list from `.env.example`.

Requirements: a Cloudflare account with Workers Paid (Containers) enabled, and `wrangler login` for deploys.

### Slack (bug-report ingress)

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) in your workspace.
2. Copy the **Signing Secret** from *Basic Information* into `SLACK_SIGNING_SECRET`.
3. Under *Event Subscriptions*, enable events and set the Request URL to `<base-url>/channels/slack/events` (for local dev, expose `http://localhost:5173` with a tunnel). The URL-verification handshake is answered automatically. **Make sure Socket Mode is off** (*Socket Mode* page in the app settings) — with it on, Slack routes events to a WebSocket instead of the Request URL and nothing ever arrives, silently.
4. Subscribe to the **`message.channels`** bot event, which requires the **`channels:history`** bot scope, then install the app to the workspace. If the bug-report channel is **private**, subscribe to **`message.groups`** (scope `groups:history`) instead — and note that after changing events or scopes you must save and **reinstall** the app before Slack delivers anything.
5. Invite the app to your bug-report channel (`/invite @your-app`) and put that channel's ID (e.g. `C0123456789`, shown in the channel's details pane) in `SLACK_BUG_CHANNEL_ID`.

The same Slack app also posts the prospecting run's summary. Give it the **`chat:write`** bot scope, copy the **Bot User OAuth Token** into `SLACK_BOT_TOKEN`, invite the app to the channel that should receive summaries, and put that channel's ID in `SLACK_PROSPECTING_CHANNEL_ID`.

### HubSpot (prospecting)

1. In HubSpot, create a **private app** (*Settings → Integrations → Private Apps*) with scopes `crm.objects.companies.read` + `.write`, `crm.objects.contacts.read` + `.write`, `crm.objects.deals.read`, `crm.schemas.companies.read` + `.write`, `crm.schemas.contacts.read` + `.write`, `sales-email-read`, and `transactional-email`. Put its token in `HUBSPOT_ACCESS_TOKEN`.
2. Create the custom properties the run writes and filters on: `node --env-file=.dev.vars scripts/setup-hubspot-properties.mjs` (idempotent; the run refuses to start if they are missing).
3. Set `HUBSPOT_SENDER_EMAIL` to an address on a verified HubSpot sending domain.
4. Only when you are ready to send for real: create a **transactional email** template (*Marketing → Email*, requires the Transactional Email add-on) whose subject is `{{ custom.subject }}` and whose body renders `{{ custom.body }}` above your legal footer and unsubscribe link, and put its id in `HUBSPOT_OUTREACH_TEMPLATE_ID`. Draft mode never needs this.
5. Put a [Brave Search API](https://brave.com/search/api/) key in `WEB_SEARCH_API_KEY` for the research tools.

### GitHub (issue filing + coding agent)

1. Create a token for the target repository — a [fine-grained personal access token](https://github.com/settings/personal-access-tokens) with **Issues: Read and write**, **Contents: Read and write**, and **Pull requests: Read and write** on that repo (or a classic token with `repo` scope). The wider-than-issues scope is what lets the coding agent clone, push its work branch, and open PRs.
2. Set `GITHUB_TOKEN` to the token and `GITHUB_REPO` to the repository as `owner/repo`.
3. Create the coding-agent label in the repository (default name `agent-fix`; override with `CODING_AGENT_LABEL`).
4. Add a repository webhook: payload URL `<base-url>/channels/github/webhook`, content type `application/json`, a secret of your choosing in `GITHUB_WEBHOOK_SECRET`, and subscribe to **Issues** events.

Point `GITHUB_REPO` at a sandbox repository first to try the flow end to end before switching to the real tracker. To trigger the coding agent manually, apply the `agent-fix` label to any issue.

## Develop

```sh
./scripts/prepare-container-context.sh   # optional: snapshot the target repo's lockfile
npm run dev
```

Runs the Worker locally (with a local sandbox container — Docker required). The prep script snapshots the target repo's `pnpm-lock.yaml` into `container-context/` so the sandbox image build pre-fetches the entire dependency store — coding-agent runs then install in seconds instead of minutes. Re-run it (and rebuild) when the target repo's lockfile changes materially; skipping it just means cold installs. Both agents are dispatched by their channels (`src/agents/bug-triage.ts` by Slack, `src/agents/coding.ts` by GitHub) — see `src/app.ts` for the route map.

To exercise the coding-agent pipeline locally without a tunnel, simulate the label event against the running dev server — it fetches the real issue and delivers a correctly signed webhook, so everything downstream (sandbox, fix, push, PR) runs for real:

```sh
node --env-file=.dev.vars scripts/simulate-label-webhook.mjs <issue-number> [port]
```

## Weekly architecture review

Every Friday at 09:00 UTC, the `ArchitectureReview` agent reviews **one** aspect of this system and files a report as a GitHub issue titled `Architecture review: <focus area> (<date>)`, labelled `ARCH_REVIEW_LABEL` (default `architecture-review`). Each report carries 3–7 findings — improvements, hardening opportunities, and technical debt — ranked by severity, each with `path:line` evidence and a proposed next step.

How it flows: a Cloudflare Cron Trigger (`triggers.crons` in `wrangler.jsonc`) fires → `scheduled()` in `src/cloudflare.ts` calls `dispatchArchitectureReview` (`src/schedules/architecture-review.ts`), which picks this week's focus area from the rotation in `src/review/focus-areas.ts` and dispatches a signal to the agent (`src/agents/architecture-review.ts`), one conversation per run keyed by the date → the agent reads the repository through the read-only tools in `src/tools/repo-inspect.ts`, checks what earlier reports already said, and files the week's report with `file_architecture_report_issue` (`src/tools/architecture-report.ts`).

The focus area is **not** chosen by the model. It rotates deterministically by week over eight areas — ingress & channel security, agent design & prompts, outbound tools & external calls, persistence & durability, configuration & secrets, dependencies & build, observability & operability, scheduled & background work — so coverage spreads across the system and next week's area is predictable. The agent is dispatch-only: no route is mounted for it, so a review can only be started by the cron.

Changing when it runs means editing `triggers.crons` in `wrangler.jsonc` and redeploying — Cloudflare evaluates cron expressions in **UTC only**, with no timezone option, so the run's date and rotation are derived in UTC too. Adding the agent also added a `flue-class-FlueArchitectureReviewAgent` migration entry there (append-only — never rewrite deployed entries).

Configuration (see `.env.example`): `ARCH_REVIEW_ENABLED`, `ARCH_REVIEW_LABEL`, and `ARCH_REVIEW_REPO` (the repo under review; defaults to `GITHUB_REPO`). `GITHUB_TOKEN` already carries the contents-read the review needs for the coding agent's sake. Setting `ARCH_REVIEW_ENABLED=false` makes a fire a no-op without removing the trigger.

Two things to know about scheduled runs: Cloudflare delivers them **at-least-once**, and a run's conversation ID and idempotency key are both the fire's date, so a repeated fire for the same Friday is a no-op rather than a second issue. Local `npm run dev` does not fire cron triggers — to exercise a run locally, call `dispatchArchitectureReview(new Date())` directly.

## Daily prospecting

Every weekday at 13:00 UTC, the `Prospecting` agent finds accounts in HubSpot that look ready to buy, researches them, picks the right people, writes each one a personalized email, sends it through HubSpot, and records everything it did back on the CRM. A summary of the run lands in Slack.

How it flows: a Cloudflare Cron Trigger fires → `scheduled()` in `src/cloudflare.ts` calls `dispatchProspecting` (`src/schedules/prospecting.ts`) → **selection happens in code, before the agent runs**: `src/prospecting/select-batch.ts` pulls recently active companies from HubSpot, `src/prospecting/scoring.ts` scores them from buying signals (form submissions, site visits, open deals, lifecycle-stage advances, recent engagement, ICP fit) with fixed weights, drops customers, closed-won accounts, `do_not_prospect`, and anything prospected within the cooldown, and keeps the top `PROSPECTING_BATCH_SIZE` → the batch is dispatched to the agent (`src/agents/prospecting.ts`), one conversation per run keyed by the date → for each company the agent reads the record, researches the company site and recent news (`src/tools/web-research.ts`), gets the eligible contacts (`src/tools/hubspot-contacts.ts`), writes and sends (`src/tools/hubspot-outreach.ts`), and records a note (+ a follow-up task for the owner when something was sent) on the company (`src/tools/hubspot-companies.ts`) → finally it posts the run summary to Slack (`src/tools/slack-summary.ts`).

```
HubSpot signals ──(scored in code)──▶ daily batch ──▶ Prospecting agent
                                                         │  research · pick contacts · write · send
                                                         ▼
                                      HubSpot: email on timeline, note + task on company
                                      Slack: one run summary
```

**What the agent knows.** Its understanding of the business lives in `docs/business/` — `company.md`, `products.md`, `icp.md`, `messaging.md` — bundled at build time and put in every prompt. Two of them carry a fenced `json` block that the code enforces: the ICP (target industries, sizes, geographies, persona title patterns, excluded domains) drives scoring and contact selection; the messaging limits (max words, banned phrases) are applied by the send tool, which rejects a message that breaks them. Edit the docs, redeploy, and the agent's behaviour changes. Start by replacing the placeholder content.

**Guardrails live in the tools, not the prompt.** The agent can only read or write companies in its batch. It only ever sees contacts that survive the hard exclusions (unsubscribed, bounced, do-not-contact, off-domain, emailed within the cooldown, no persona match), and the send tool re-checks eligibility and takes the recipient address from the CRM record at send time. Every message must cite evidence — a URL fetched during this run or a `hubspot:<property>` reference — or it is rejected. A contact is sent to at most once per run, a send whose outcome is unknown is never retried, and `OUTREACH_DAILY_CAP` bounds real sends per run. Research fetches refuse private addresses and are budgeted per company.

**Rollout and rollback.** The run ships with `OUTREACH_ENABLED=false`: everything happens except the send, which instead stores the email as a *Draft outreach* note on the contact. Watch a few days of draft notes, company outcome notes, and Slack summaries; tune `docs/business/` and the weights in `src/prospecting/scoring.ts`; then create the transactional template, set `HUBSPOT_OUTREACH_TEMPLATE_ID`, and flip `OUTREACH_ENABLED=true` with a low cap. `OUTREACH_ENABLED=false` stops sending immediately without a redeploy; `PROSPECTING_ENABLED=false` stops runs altogether. Changing *when* it runs means editing `triggers.crons` in `wrangler.jsonc` (UTC only) and the matching `CRON` entry in `src/cloudflare.ts`.

Configuration (see `.env.example`): `PROSPECTING_ENABLED`, `OUTREACH_ENABLED`, `PROSPECTING_BATCH_SIZE`, `OUTREACH_DAILY_CAP`, `OUTREACH_COOLDOWN_DAYS`, `OUTREACH_CONTACTS_PER_COMPANY`, `PROSPECTING_LOOKBACK_DAYS`, `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_SENDER_EMAIL`, `HUBSPOT_OUTREACH_TEMPLATE_ID`, `SLACK_BOT_TOKEN`, `SLACK_PROSPECTING_CHANNEL_ID`, `WEB_SEARCH_API_KEY`.

Scheduled runs are delivered at-least-once and keyed by the fire's date, so a repeated fire for the same day is a no-op. Local `npm run dev` does not fire cron triggers — to exercise a run by hand against the dev server, `node --env-file=.dev.vars scripts/run-prospecting.mjs [YYYY-MM-DD]`. Point `HUBSPOT_ACCESS_TOKEN` at a test portal first.

## Deploy

```sh
./scripts/prepare-container-context.sh   # warm-store snapshot (optional but recommended)
npm run build
npx wrangler deploy
```

First deploy: run `npx wrangler login`, then set each secret with `npx wrangler secret put <NAME>` (`OPENROUTER_API_KEY`, `SLACK_SIGNING_SECRET`, `SLACK_BUG_CHANNEL_ID`, `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_WEBHOOK_SECRET`, and optionally `CODING_AGENT_LABEL`, `ARCH_REVIEW_ENABLED`, `ARCH_REVIEW_LABEL`, `ARCH_REVIEW_REPO`). The container image (`Dockerfile`, pinned to the installed `@cloudflare/sandbox` version) is built and pushed as part of the deploy. Point the Slack and GitHub webhook URLs at the deployed Worker.

### Continuous deploy

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) typechecks, builds, and runs `wrangler deploy` automatically on every push to `main` — in practice, every merged PR. It needs two repository secrets (**Settings → Secrets and variables → Actions**), separate from the `wrangler secret put` values above: `CLOUDFLARE_API_TOKEN` (scoped with the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`.

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
