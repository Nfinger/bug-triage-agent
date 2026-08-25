# Tasks: Source New Companies

## 1. CRM and scoring foundations

- [x] 1.1 `src/prospecting/crm.ts`: add `createCompany(properties)` (name, domain, state, industry, agent_sourced, agent_sourced_run), `ensureProperty(objectType, definition)` (idempotent create-if-missing), and read `agent_sourced`/`agent_sourced_run` in `COMPANY_PROPERTIES`
- [x] 1.2 `src/prospecting/scoring.ts`: `sourced-fresh` signal (+15) when `agent_sourced` is true and `agent_sourced_run` is within the lookback window; counts as a non-fit signal for the no-signal exclusion; unit tests (selectable when fit-only + sourced, expires after lookback, warm accounts still outrank)
- [x] 1.3 `src/prospecting/config.ts`: `sourcingEnabled()` (default true), `sourcingMaxCompanies()` (default 5); `.env.example` entries

## 2. Sourcing agent

- [x] 2.1 `src/prospecting/sourcing-categories.ts`: fixed category list mirroring the ICP prose + deterministic `focusCategoryFor(runDate)` rotation; unit test (deterministic, consecutive days differ)
- [x] 2.2 `src/tools/hubspot-sourcing.ts`: `create_company` tool — per-run cap in code, domain normalized + deduped via `findCompanyByDomain`, company site must be in `fetchedUrls`, Maine state + ICP industry required, excluded/free-mail domains refused, marker properties set, note with source URLs; unit tests for every refusal and the cap
- [x] 2.3 `src/agents/sourcing.ts`: dispatch-only `Sourcing` agent — `fetch_page`/`web_search` under a per-run budget, `create_company`, Slack summary tool; prompt: research the focus category (plus incidental finds), verify Maine from the business's own site, never invent businesses, record skips with reasons
- [x] 2.4 `src/schedules/sourcing.ts`: `dispatchSourcing(firedAt, {runId?})` — gate on `SOURCING_ENABLED`, ensure custom properties, compute focus category, dispatch with `sourcing-<date>` idempotency; absorb duplicate fires

## 3. Wiring

- [x] 3.1 `wrangler.jsonc`: add cron `0 12 * * 1-5` and append DO migration for the Sourcing agent class; `src/cloudflare.ts`: route the new expression to `dispatchSourcing`
- [x] 3.2 Manual trigger: add `POST /schedules/sourcing/run` (same bearer token, unique manual run id) alongside the prospecting one; mount in `src/app.ts`

## 4. Tests & verify

- [x] 4.1 `npm test` and `npm run check:types` pass (new tests from 1.2, 2.1, 2.2 plus a dispatcher idempotency/config test)
- [ ] 4.2 Deploy via CI; trigger a manual sourcing run and confirm: companies created in HubSpot with markers and notes, Slack summary posted, dedupe refuses a rerun of the same finds
- [ ] 4.3 Next prospecting run (cron or manual): confirm a sourced company earns `sourced-fresh`, gets selected, and flows through contact discovery; then archive the change and sync deltas
