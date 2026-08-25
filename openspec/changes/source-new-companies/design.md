# Design: Source New Companies

## Context

Prospecting selection is read-only over HubSpot companies; nothing automates the top of the funnel. The pool is ~12 companies, mostly cooled-down, skewed brewery. All the downstream machinery (scoring, discovery, Hunter lookups, draft outreach, cooldowns) works — it's starved of input. Constraints: prod env vars exist only as worker secrets; scoring excludes fit-only companies ("no-signal"); the repo's pattern is one agent per job, dispatch-only via cron, guardrails in tools.

## Goals / Non-Goals

**Goals:** a daily trickle of net-new, deduped, Maine-ICP companies with provenance, spread across the ICP's categories; sourced companies become *selectable* by scoring without outranking warm accounts.
**Non-Goals:** contacting anyone from the sourcing run (prospecting still owns outreach); buying company lists or using paid data providers for sourcing (web research only — Hunter stays a contact-level tool); modifying or deleting existing companies; lifting the draft-mode default.

## Decisions

1. **Separate agent, separate cron (12:00 UTC weekdays), same runtime patterns.** Sourcing is research-heavy with different tools and its own summary; folding it into the prospecting agent would couple budgets and blur guardrails. Firing an hour before prospecting means the morning's finds — freshly created, thus recently modified — enter the same day's candidate pool. Date-keyed idempotency (`sourcing-<date>`), append-only DO migration, dispatch-only.
2. **Category rotation computed in the dispatcher, not chosen by the model.** `categories[dayOfYear % categories.length]` from a fixed list mirroring the ICP prose (wedding/event venues; campgrounds/resorts; restaurants/breweries/taprooms; corporate HR/offices; community & civic orgs; recreation/golf/activity centers). Passed in `initialData`. This is the direct fix for "why is it only breweries" — coverage becomes a property of the schedule, not model whim.
3. **`create_company` mirrors `create_contact`'s evidence discipline.** The company's own site must be in `fetchedUrls` (proves it exists, and the fetch gives the agent the evidence for name/state/industry); domain deduped against HubSpot via the existing `findCompanyByDomain`; cap counted in code per run; `agent_sourced`/`agent_sourced_run` set so humans can filter and audit; a note carries source URLs. State must be Maine (ME accepted) — out-of-state finds are refused, not down-scored, because creation is the one irreversible-ish step.
4. **`sourced-fresh` (+15) satisfies the no-signal rule.** Weight sits below every inbound signal (visit 15 is the floor; sourced-fresh matches it but stage-advance/deal/form all exceed it), so a warm account always outranks a cold sourced one. Tied to `agent_sourced_run` within `PROSPECTING_LOOKBACK_DAYS`: a sourced company that generates no real signal ages out in 30 days instead of being re-worked forever.
5. **Dispatcher ensures custom properties exist (create-if-missing).** The setup script needs prod vars nobody has locally; `assertCustomProperties`-style failure would brick the first fire. `Crm.ensureProperty` creates `agent_sourced` (bool) and `agent_sourced_run` (date) idempotently; existing prospecting properties keep their assert-only behavior.
6. **Manual trigger reuses `PROSPECTING_MANUAL_TOKEN`.** One operator token for one operator surface; the route moves under a shared `/schedules` router with per-schedule paths.

## Risks / Trade-offs

- [Junk or misidentified companies enter the CRM] → cap 5/run, site-fetched evidence, Maine + ICP-industry required, agent-sourced marker makes bulk review/cleanup trivial; outreach to them is still draft-mode and persona-gated.
- [Sourced companies immediately consume prospecting batch slots] → sourced-fresh (+15 + fit 30 = 45) scores below any account with a real signal + fit; batch is score-ordered, so warm accounts still win slots.
- [Duplicate businesses under www/bare or vanity domains] → domains normalized with the existing `normalizeDomain` before dedupe; identical-name/different-domain dupes are possible but human-reviewable via the marker.
- [Research budget spent on directories that list businesses without domains] → prompt steers toward candidates with their own site; the cap is on creations, not finds, so a thin run just creates fewer.
- [Two crons within an hour double worker load] → both runs are small; idempotency keys are independent; no shared mutable state.

## Migration Plan

Deploy via CI (cron + migration ship together; migrations are append-only). First fire creates the custom properties. Rollback: set `SOURCING_ENABLED=false` (fires become logged no-ops) or revert; created companies remain, identifiable by `agent_sourced=true` for manual cleanup if ever wanted.

## Open Questions

None.
