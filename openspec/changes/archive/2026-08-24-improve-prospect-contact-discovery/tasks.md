# Tasks: Improve Prospect Contact Discovery

## 1. Sync branch with prospecting code

- [x] 1.1 Fast-forward `well-duke` to `origin/main` (`git merge --ff-only origin/main`) so the prospecting agent, tools, specs, and tests are present locally; confirm `npm test` passes at the merge point

## 2. Research budget: discovery bonus, refunds, attempt cap

- [x] 2.1 Extend `ResearchBudget` (`src/prospecting/research-budget.ts`) with `grantDiscoveryBonus(companyId)` (+3 fetches, +2 searches, idempotent per company), `refund(companyId, kind)` (never below zero used), per-company fetch-attempt tracking with a cap, and `takeAttempt(companyId)`; expose remaining attempts in `remaining()`
- [x] 2.2 Unit tests in `tests/research-budget.test.mjs` (or the existing budget test file): bonus granted once, refund restores a unit, refund cannot go negative, attempt cap blocks further fetches even with budget remaining

## 3. Web research tool: don't charge failed fetches

- [x] 3.1 In `fetch_page` (`src/tools/web-research.ts`), check/consume an attempt before fetching, and refund the fetch unit when `fetchPageText` returns `ok: false`; include remaining attempts in the error message and a clear `ok: false` message when the attempt cap is reached
- [x] 3.2 Unit test with a stubbed `doFetch`: a 400 response leaves `remainingFetches` unchanged, repeated failures stop at the attempt cap

## 4. Contact tools: grant discovery in code

- [x] 4.1 In `list_eligible_contacts` (`src/tools/hubspot-contacts.ts`), when the evaluation yields zero eligible contacts, call `context.research.grantDiscoveryBonus(companyId)` and add a field to the tool output stating discovery budget was granted and the agent should research for a named person
- [x] 4.2 Unit test: zero-eligible listing grants the bonus exactly once across repeated calls; non-empty listing grants nothing

## 5. Outcome recording: human task on no-contact skips

- [x] 5.1 In `record_company_outcome` (`src/tools/hubspot-companies.ts`), when status is `skipped` and no contact was eligible or created, create a HubSpot follow-up task on the company via the existing `Crm` task helper ("Prospecting agent could not find a contact — find one"), attributed with the run date; verify skipped outcomes set `last_prospected_at` so cooldown prevents daily task re-creation, and set it if they do not
- [x] 5.2 Unit test: no-contact skip creates the task; a sent outcome does not create the find-a-contact task

## 6. Agent prompt: reorder loop and add discovery playbook

- [x] 6.1 In `src/agents/prospecting.ts`, reorder the per-company loop to `get_company` → `list_eligible_contacts` → research → (`create_contact` if discovery found someone) → write → send → record
- [x] 6.2 Add the contact-discovery playbook to the research step: follow team/about/staff/leadership/contact links seen on fetched pages, try common alternate paths after a failed fetch, search company name + persona titles and press releases; a search snippet is not evidence — fetch the page; never invent names, titles, or emails
- [x] 6.3 Require skip outcomes for lack of a contact to list the discovery attempts (URLs tried, queries run) in the recorded summary/skipReason

## 7. Verify

- [x] 7.1 `npm test` passes
- [x] 7.2 Dry-run end-to-end — skipped locally (no `.dev.vars`; credentials live only in prod). Per user decision, verification happens in prod: outreach stays in draft mode (`OUTREACH_ENABLED` default false), and the next 13:00 UTC weekday cron run exercises discovery. Unit tests cover every seam (budget grant/refund/cap, discovery grant, skip task).
- [x] 7.3 Update the delta specs if implementation details diverged, then validate the change with `openspec status --change improve-prospect-contact-discovery`
