## 1. Configuration and business knowledge

- [x] 1.1 Add `src/prospecting/config.ts`: `prospectingEnabled()`, `outreachEnabled()`, `batchSize()`, `dailyCap()`, `cooldownDays()`, `contactsPerCompany()`, `hubspotToken()`, `senderEmail()`, `outreachTemplateId()` (required only when outreach enabled), `slackProspectingChannel()`, `webSearchApiKey()` — each throwing on invalid/missing values, following `src/review/config.ts`
- [x] 1.2 Create `docs/business/company.md`, `products.md`, `icp.md` (with fenced YAML block: industries, sizeRanges, geographies, personaTitlePatterns, excludedDomains), `messaging.md` (tone, max words, banned phrases, required footer) with starter content and inline guidance comments
- [x] 1.3 Add `src/prospecting/knowledge.ts`: `?raw` imports of the four docs, size cap, valibot schema for the ICP YAML block, `loadKnowledge()` returning `{ prose, icp, messaging }`; fail fast on missing/invalid
- [x] 1.4 Add `?raw` module declaration if needed and confirm Vite/Cloudflare bundling of the docs in `npm run build`
- [x] 1.5 Update `.env.example` with all new variables and comments

## 2. HubSpot client and CRM tools

- [x] 2.1 (fetch-based, no SDK) Create `src/channels/hubspot-client.ts` with a configured client, 429 retry with `Retry-After`/backoff up to a fixed attempt limit, and a `hubspotCall()` wrapper that converts errors into `{ok:false,error}`
- [x] 2.2 Add `scripts/setup-hubspot-properties.mjs` that creates custom properties `last_prospected_at`, `do_not_prospect` (company) and `agent_created`, `agent_created_run` (contact) if absent; add a startup check in config that they exist
- [x] 2.3 Add `src/tools/hubspot-companies.ts`: `get_company` (properties, associated contacts with subscription status/last email/title, open deals, recent engagements; rejects IDs not in the batch) and `record_company_outcome` (note on company, follow-up task for owner on `sent`, sets `last_prospected_at`)
- [x] 2.4 Add `src/tools/hubspot-contacts.ts`: `list_eligible_contacts` applying hard exclusions (unsubscribed/non-opt-in, hard bounce, do-not-contact/do-not-prospect, foreign domain, emailed within cooldown) and persona ranking from ICP; `create_contact` enforcing company-domain match and agent-created markers with association
- [x] 2.5 Unit tests for exclusion logic and persona ranking with fixture contacts (`tests/contact-selection.test.mjs`)

## 3. Buying-signal scoring and batch selection

- [x] 3.1 Add `src/prospecting/scoring.ts`: pure `scoreCompany(snapshot, icp, weights)` returning `{score, signals[]}` with the documented default weights and lookback window
- [x] 3.2 Add `selectBatch()` that queries HubSpot companies (search API + associations + engagement recency + web activity where available), applies exclusions (customer stage, closed-won deal, `do_not_prospect`, cooldown), scores, sorts, and caps to `PROSPECTING_BATCH_SIZE`
- [x] 3.3 Unit tests for scoring determinism, weight application, and exclusions (`tests/scoring.test.mjs`)

## 4. Web research tools

- [x] 4.1 Add `src/tools/web-research.ts`: `fetch_page` (http(s) only, SSRF guard on hostnames/IP literals and each redirect hop, 10s timeout, HTML→text, 20KB cap with truncated flag) and `web_search` (search-provider adapter interface, Brave implementation, result cap)
- [x] 4.2 Add per-run `ResearchBudget` (per-company fetch/search counts) and wire it into both tools returning `ok:false` when spent
- [x] 4.3 Unit tests for SSRF guard, truncation, and budget (`tests/web-research.test.mjs`)

## 5. Outreach send tool

- [x] 5.1 Add `src/prospecting/ledger.ts`: per-run `OutreachLedger` (per-contact at-most-once incl. uncertain outcomes, send count vs daily cap)
- [x] 5.2 Add `src/prospecting/lint.ts`: message linting from `messaging.md` (max words, banned phrases) and evidence validation (URLs fetched this run or `hubspot:` property refs)
- [x] 5.3 Add `src/tools/hubspot-outreach.ts`: `send_outreach_email` implementing D4 — re-check eligibility, recipient from record, lint, ledger, draft-note mode when disabled or capped, single-send API call with template ID, uncertain-outcome handling
- [x] 5.4 Unit tests for ledger, lint, draft mode, cap, and duplicate refusal with a mocked HubSpot client (`tests/outreach.test.mjs`)

## 6. Slack summary

- [x] 6.1 Add `src/tools/slack-summary.ts`: `post_run_summary` posting one `chat.postMessage` to `SLACK_PROSPECTING_CHANNEL_ID` via `SLACK_BOT_TOKEN`; failures logged, never thrown
- [x] 6.2 Document the new `chat:write` scope and channel invite in README Slack setup

## 7. Agent and schedule

- [x] 7.1 Add `src/agents/prospecting.ts`: `Prospecting` agent with `initialData` schema `{runDate, batch[]}`, `useModel`, all tools bound, prompt describing the per-company loop, evidence rule, no-retry-on-send rule, and final summary call; include business-doc prose in the prompt
- [x] 7.2 Add `src/schedules/prospecting.ts`: `dispatchProspecting(firedAt)` — enable flag, `selectBatch()`, empty-batch Slack line, date-keyed conversation/idempotency, absorb same-day refire
- [x] 7.3 Update `src/cloudflare.ts` `scheduled()` to route by `controller.cron` to the review or prospecting dispatcher
- [x] 7.4 Update `wrangler.jsonc`: add `"0 13 * * 1-5"` cron and append `flue-class-FlueProspectingAgent` migration entry (append-only)
- [x] 7.5 Add `scripts/run-prospecting.mjs` to invoke the dispatcher by hand for a date (verification / backfill)

## 8. Verification and docs

- [x] 8.1 `npm run check:types`, `npm test`, `npm run build` pass
- [ ] 8.2 Run `scripts/run-prospecting.mjs` against the dev server with `OUTREACH_ENABLED=false` against a sandbox HubSpot portal; confirm draft notes, company outcome notes, and Slack summary appear
- [ ] 8.3 Create the transactional email template in the portal, set `HUBSPOT_OUTREACH_TEMPLATE_ID`, send one real email to an internal test contact with `OUTREACH_ENABLED=true` and cap 1; confirm timeline logging and footer
- [x] 8.4 Update `README.md` (new "Daily prospecting" section: flow, HubSpot private-app scopes, template setup, rollout/rollback flags) and `AGENTS.md` layout notes
