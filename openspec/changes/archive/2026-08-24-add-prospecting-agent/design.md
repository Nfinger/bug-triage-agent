## Context

This is a Flue project deployed as a Cloudflare Worker. It already has three agents: `BugTriage` (Slack-dispatched), `Coding` (GitHub-dispatched, sandboxed), and `ArchitectureReview` (cron-dispatched, dispatch-only, date-keyed idempotency). The prospecting agent is a fourth, and it is the first one whose side effects reach people outside the engineering loop: it sends email to prospects through HubSpot.

Decisions the user already made: send automatically via HubSpot (not draft-for-approval), learn the business from repo-checked-in docs, run on a daily cron, and research with web search + company website fetch.

Constraints: Cloudflare cron is UTC and at-least-once; Workers have no filesystem at runtime (docs must be bundled); HubSpot rate limits (~100 req/10s for private apps) and the single-send API require specific scopes; everything the model can mistake must be bounded in tools rather than prompts — the existing pattern in `src/tools/architecture-report.ts` and `src/tools/repo-inspect.ts`.

## Goals / Non-Goals

**Goals:**
- One daily run that turns HubSpot buying signals into N personalized, sent emails with a complete CRM audit trail.
- Deterministic, inspectable account selection and contact exclusion done in code; the model does research, judgement, and writing only.
- Safe-by-default rollout: ship disabled (draft-note mode), low caps, cooldowns, hard exclusions.
- Reuse existing patterns: `useInitialData` + schedule dispatcher, `defineTool` with `ok: false` failure returns, config modules that throw on invalid values, append-only wrangler migrations.

**Non-Goals:**
- Multi-step sequences / follow-up cadences (one email per contact per run; follow-up is a human task on the company).
- Reply handling or inbox monitoring.
- Third-party enrichment providers (Apollo etc.) — can be added later behind the same contact-selection tool.
- A UI. Observability is the Slack summary plus HubSpot notes/tasks.
- Slack-initiated on-demand runs (a manual dispatcher script covers verification).

## Decisions

### D1. Selection happens before the agent, in code
`src/prospecting/scoring.ts` queries HubSpot (companies search API with property filters + associations + recent engagements), computes a weighted score, applies exclusions (customer stage, closed-won deal, `do_not_prospect`, cooldown via a `last_prospected_at` company property), and returns the top `PROSPECTING_BATCH_SIZE`. The schedule dispatcher passes this batch as `initialData`.
*Why:* mirrors how the architecture review's focus area is chosen by the schedule, not the model; makes "why was this account picked" reproducible and testable without a model; keeps the agent's token budget for research and writing.
*Alternative rejected:* giving the agent a `search_companies` tool and letting it decide — non-deterministic, hard to audit, easy to drift into contacting customers.

### D2. Knowledge = bundled markdown with a validated front-matter block
`docs/business/{company,products,icp,messaging}.md` are imported at build time (`?raw` via Vite) by `src/prospecting/knowledge.ts`, which validates presence, a total size cap (~40KB), and parses a fenced JSON block in `icp.md` (and the messaging limits in `messaging.md`) (industries, size ranges, geos, persona title regexes, excluded domains) with valibot. Scoring and contact selection consume the parsed block; the agent prompt gets the full prose.
*Why:* Workers have no runtime FS; build-time import gives versioned, reviewable knowledge with zero runtime dependency. Validation at startup means a bad doc fails the run before any CRM write.
*Alternative rejected:* Notion/Drive at runtime — adds a connector, auth, and an unversioned source of truth.

### D3. Agent structure and tool set
`src/agents/prospecting.ts` (`'use agent'`, `Prospecting`, `useModel('openrouter/anthropic/claude-opus-5')`) receives `{ runDate, batch: [{companyId, name, domain, score, signals[]}] }` via `useInitialData`. Tools (all `defineTool`, all return `ok: false` on failure):
- `get_company(companyId)` — properties + associated contacts (with subscription status, last emailed, title) + open deals + recent engagements. Only IDs in the batch are accepted.
- `list_eligible_contacts(companyId)` — applies the hard exclusions from the contact-selection spec and returns the survivors ranked by persona match/recency/seniority. The agent never sees excluded contacts.
- `create_contact(companyId, {firstName, lastName, email, title, sourceUrl})` — domain must equal company domain; sets `agent_created=true`, `agent_created_run=<date>`; associates.
- `fetch_page(url)` / `web_search(query)` — `src/tools/web-research.ts`; per-company budgets (e.g. 4 fetches, 3 searches) tracked in a per-run `ResearchBudget`; SSRF guard (http(s) only, refuse private/loopback/link-local hostnames and IP literals); 20KB text cap; HTML→text extraction without executing anything.
- `send_outreach_email(contactId, subject, body, evidence[])` — see D4.
- `record_company_outcome(companyId, {status: sent|drafted|skipped, summary, contacts[], sources[]})` — creates the note, and a follow-up task for the owner when `sent`; sets `last_prospected_at` on the company (this is what the cooldown exclusion reads).
- `post_run_summary(...)` — Slack `chat.postMessage`; called once at the end.

The prompt instructs a per-company loop: read → research → select → write → send → record, and finishes with the summary. It forbids sending without research evidence and forbids retrying a failed send.

### D4. Sending: HubSpot single-send, with guardrails inside the tool
`send_outreach_email` is where all irreversible risk concentrates, so it enforces everything itself regardless of prompt:
1. Contact must belong to a company in the batch and must pass `list_eligible_contacts` exclusions (re-checked at send time, not just at listing).
2. Recipient email is read from the contact record; model-supplied addresses are ignored.
3. Message linting from `messaging.md`: max words, banned phrases, must include at least one `evidence[]` item that is a URL fetched this run or a `hubspot:` property reference.
4. Per-run `OutreachLedger` (in-memory per run, keyed by contactId): second call for the same contact refused; counts sends against `OUTREACH_DAILY_CAP`.
5. `OUTREACH_ENABLED=false` or cap reached → write the message as a note titled `Draft outreach (<date>)` on the contact and return `{ok:true, sent:false, reason}`.
6. Otherwise call HubSpot `POST /marketing/v3/transactional/single-email/send` with `emailId` = a pre-built transactional template in the portal whose body renders `{{ custom.body }}` (HubSpot requires a template ID; the template carries the unsubscribe footer and branding), `message.to` = record email, `message.from` = `HUBSPOT_SENDER_EMAIL`, `customProperties` = {subject, body}. HubSpot logs the send on the contact timeline.
7. Timeout → return `{ok:false, uncertain:true}`, record it in the ledger as consumed so it can't be retried in-run.
*Why single-send over Sequences or `POST /crm/v3/objects/emails`:* Sequences API requires a user-level OAuth context and is enrolment-oriented; creating an email engagement only logs, it doesn't send. Single-send actually delivers, honors subscription types, and logs.
*Why a ledger in the tool rather than the prompt:* the model can be told "send once"; the ledger makes it true.

### D5. Schedule and idempotency
`src/schedules/prospecting.ts` mirrors `dispatchArchitectureReview`: `conversationId = prospecting-<UTC date>`, same `idempotencyKey`, absorb the "different submission" idempotency error on a same-day refire. `src/cloudflare.ts` `scheduled()` switches on `controller.cron` (`"0 9 * * 5"` → review, `"0 13 * * 1-5"` → prospecting; weekdays only, 13:00 UTC ≈ morning in the Americas). wrangler gets a second cron and an appended `flue-class-FlueProspectingAgent` migration.
Selection (D1) runs inside the dispatcher before `dispatch()`, so a disabled or empty day dispatches nothing but still posts a "0 accounts selected" Slack line.

### D6. Cooldown and dedup state lives in HubSpot, not in our DB
`last_prospected_at` (company) and HubSpot's own last-email-sent / engagement history (contact) are the source of truth for cooldowns. *Why:* survives redeploys and DB resets, visible to sales reps in the CRM, no schema migration. Custom properties (`last_prospected_at`, `do_not_prospect`, `agent_created`, `agent_created_run`) are created once by `scripts/setup-hubspot-properties.mjs`, and the config module fails fast if they're missing.

### D7. Web search provider
`web_search` calls a configurable JSON search API (default: Brave Search API via `WEB_SEARCH_API_KEY`; a single adapter interface so Tavily/Serper swap in). `fetch_page` uses Worker `fetch` with a 10s timeout, manual redirect handling (re-validating each hop), and a simple HTML-to-text pass (strip script/style/nav, collapse whitespace).

### D8. Model choice
`openrouter/anthropic/claude-opus-5` for the agent (writing quality matters, batch is small). Scoring and selection are not model-driven at all.

## Risks / Trade-offs

- [Agent emails the wrong person / a customer / an unsubscribed contact] → all exclusions re-checked inside `send_outreach_email`; the model only ever sees eligible contacts; customers excluded at selection.
- [Hallucinated personalization damages credibility] → send requires `evidence[]` pointing at URLs fetched this run or CRM properties; prompt forbids unevidenced claims; summary exposes sources for spot checks.
- [Runaway volume] → `OUTREACH_DAILY_CAP` enforced in-tool; batch size enforced in code; cron weekdays only; ships with `OUTREACH_ENABLED=false`.
- [Duplicate sends on cron refire or agent retry] → date-keyed idempotency for the run; per-run ledger for contacts; cooldown read from HubSpot for cross-run.
- [HubSpot rate limits mid-run] → client retries 429 with `Retry-After`; batch size keeps calls per run in the low hundreds.
- [Deliverability / compliance] → single-send honors subscription status and includes the template's unsubscribe footer; sender is a verified HubSpot sending domain; `messaging.md` carries the legal footer requirements.
- [SSRF via `fetch_page`] → scheme + hostname/IP rules; no redirects into private ranges.
- [Prompt injection from fetched pages] → page text is returned framed as untrusted data; tools never take instructions from content; send guardrails don't depend on the prompt.
- [Unknown send outcome] → reported as uncertain, never auto-retried; visible in the Slack summary and the company note.
- [Single-send needs a template ID configured in the portal] → documented setup step; config fails fast when `HUBSPOT_OUTREACH_TEMPLATE_ID` is missing while `OUTREACH_ENABLED=true`.

## Migration Plan

1. Land code with `PROSPECTING_ENABLED=true`, `OUTREACH_ENABLED=false`, `PROSPECTING_BATCH_SIZE=5`, `OUTREACH_DAILY_CAP=5`. Run the property setup script against the portal. Deploy with a fresh build.
2. Observe several days of draft notes and Slack summaries in the CRM; tune `icp.md`, `messaging.md`, scoring weights.
3. Create the transactional template, set `HUBSPOT_OUTREACH_TEMPLATE_ID`, flip `OUTREACH_ENABLED=true` with the cap still low; raise gradually.
4. Rollback: set `OUTREACH_ENABLED=false` (stops sending immediately, no redeploy) or `PROSPECTING_ENABLED=false` (stops runs). Removing the cron requires a redeploy; the migration entry stays.

## Open Questions

- Initial scoring weights and lookback window (proposed: 30-day lookback; form submission 40, site visit 15, open deal 25, stage advance 20, inbound engagement 20, ICP fit 0–30) — to be tuned from draft-mode observation.
- Whether `OUTREACH_CONTACTS_PER_COMPANY` should default to 1 or 2.
- Which HubSpot subscription type ID the sends attach to (portal-specific; configured, not hardcoded).
