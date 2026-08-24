# Design: Improve Prospect Contact Discovery

## Context

The prospecting agent (`src/agents/prospecting.ts`, on `origin/main`) works a code-selected batch of HubSpot companies: research → `list_eligible_contacts` → write → send → record. Companies with no HubSpot contact are skipped unless research already surfaced a named person with a company-domain email on a fetched page (`create_contact`'s guardrails in `src/tools/hubspot-contacts.ts`). Three interacting behaviors caused the Point Lookout skip:

1. The prompt orders research (step 2) before the contact check (step 3), so the 4-fetch/3-search budget (`src/prospecting/research-budget.ts`) is spent on personalization before the agent knows it needs to find a person.
2. `fetch_page` (`src/tools/web-research.ts`) charges the budget before fetching, so a 400 response burns a fetch with nothing to show.
3. The prompt has no people-finding playbook — no direction to try team/staff/leadership pages, alternate URLs after a failure, or persona-title searches.

Additionally, the `contact-selection` spec's "No matching contact" scenario says a human task is recorded on skip, but `record_company_outcome` (`src/tools/hubspot-companies.ts`) only creates follow-up tasks for sent/uncertain outcomes — the skip task was never implemented.

This branch (`well-duke`) is at `2aa18c5`, an ancestor of `origin/main` (`cb9cf36`) which holds all prospecting code; implementation begins with a fast-forward merge.

## Goals / Non-Goals

**Goals:**
- A company with strong signals but no HubSpot contact gets a real, budgeted attempt at finding a named person before being skipped.
- Failed fetches stop eating the budget; retrying an alternate URL is cheap but bounded.
- Skips for lack of a contact leave a useful trail: documented attempts plus a HubSpot task for a human.
- All existing safety guardrails unchanged: batch fencing, fetched-URL evidence, company-domain email, no invented names/emails.

**Non-Goals:**
- No email-pattern inference (guessing `first.last@domain`): the "never invent email addresses" rule stands; a person is creatable only when their email appears on a fetched page.
- No third-party contact-data providers (Apollo, Hunter, LinkedIn APIs) — web fetch + Brave search only.
- No changes to scoring, batch selection, sending, linting, or scheduling.
- No new env vars; discovery bonus and attempt cap are code constants alongside the existing budget defaults.

## Decisions

**1. Grant the discovery bonus in code, inside `list_eligible_contacts`.**
When the eligibility evaluation returns zero eligible contacts, the tool calls a new `ResearchBudget.grantDiscoveryBonus(companyId)` (+3 fetches, +2 searches, idempotent per company) and reports it in the tool output ("no eligible contacts; discovery research budget granted"). Alternative considered: let the model request a bigger budget via a tool — rejected because budgets must not be model-controlled (house rule: guardrails live in tools, not the prompt). Alternative: raise the flat budget for everyone — rejected because it doubles research cost on the ~normal case where contacts already exist.

**2. Reorder the per-company loop: contacts before research.**
New prompt order: `get_company` → `list_eligible_contacts` → research (personalization, plus contact discovery when nobody was eligible) → `create_contact` if discovery succeeded → write → send → record. This costs nothing (the contact list is one HubSpot read that happened anyway) and lets the agent spend the whole budget knowingly. The send tool re-runs eligibility, so an early listing introduces no staleness risk.

**3. Refund failed fetches; bound attempts separately.**
`ResearchBudget` tracks `fetchAttempts` per company with a cap of `fetches + discovery bonus + 4` (i.e., a handful of free retries). `fetch_page` takes a budget unit up front (unchanged) but calls a new `refund(companyId, 'fetches')` when `fetchPageText` returns `ok: false`. Attempts are checked before the fetch; at the cap the tool returns `ok: false` with a clear "attempt cap reached" message. Alternative: only charge on success with no attempt tracking — rejected: a hostile or broken site could then absorb unlimited requests.

**4. Contact-discovery playbook lives in the prompt; mechanics stay in tools.**
The prompt's research step gains a short discovery sub-list: fetch the homepage and follow visible team/about/staff/leadership/contact links; if a path 4xxs, try the obvious variants (`/contact-us`, `/about-us`, `/team`, `/staff`); search `"<company name>" <persona title>` and for press releases naming staff; a search snippet alone is not evidence — fetch the result page before using a person found there. This is guidance only; every hard rule remains enforced by `create_contact`.

**5. Human task on no-contact skips, created by `record_company_outcome`.**
When `status: 'skipped'` and no contact was eligible or created, the tool creates a HubSpot task on the company ("Prospecting agent could not find a contact — find one", due in a few days) via the existing `Crm` task helper used for sent follow-ups, and requires the skip note to carry the attempts (the prompt instructs the agent to list URLs tried and queries run in the summary/skipReason). This closes the existing spec-implementation gap. Alternative: create the task from the schedule after the run — rejected: the outcome tool already owns per-company CRM writes and has the context.

## Risks / Trade-offs

- [More HubSpot/API calls per no-contact company] → Bonus is small (+3/+2), granted only when the contact list is empty, and attempt-capped; worst case a batch of 5 no-contact companies adds ~25 web requests and 5 task creations.
- [Refund-on-failure invites hammering an erroring site] → Attempt cap bounds total requests per company regardless of refunds.
- [Agent fetches LinkedIn/aggregator pages that fail or paywall] → Failures are now cheap (refunded) and the playbook steers toward the company's own site first; the evidence rule already blocks unverifiable people.
- [Task spam if the same company is re-selected across runs] → Existing cooldown (`last_prospected_at` is set for skipped companies too via `record_company_outcome`) keeps a company out of subsequent batches for `OUTREACH_COOLDOWN_DAYS`; verify during implementation that skipped outcomes set the cooldown property — if they do not, set it for no-contact skips so the task isn't recreated daily.
- [Prompt reorder changes agent behavior broadly] → The loop's tools and guardrails are unchanged; a dry run via `scripts/run-prospecting.mjs` with `OUTREACH_ENABLED` off validates end-to-end before relying on the cron.

## Migration Plan

1. Fast-forward `well-duke` to `origin/main` (clean ancestor merge).
2. Land changes behind no flag — behavior change is safe with `OUTREACH_ENABLED` defaulting to false (draft mode).
3. Validate with `node --env-file=.dev.vars scripts/run-prospecting.mjs` against a date that selects a no-contact company.
4. Rollback: revert the commit; no data or schema migrations involved.

## Open Questions

- None blocking. If discovery consistently fails for hospitality ICPs (people rarely published with emails), a follow-up change could consider a vetted contact-data provider — explicitly out of scope here.
