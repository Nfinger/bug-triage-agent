## Context

The pipeline is built and verified (change `add-prospecting-agent`); the run refused to pitch because the bundled business docs describe a fictional software company. This change swaps in Yard Games World's real content, aimed at the Maine expansion, and closes the one code gap it exposes: geography fit only reads `country`.

## Goals / Non-Goals

**Goals:** docs a Maine prospecting run can act on; state-level geography fit; keep every existing guardrail intact.

**Non-Goals:** new signals or tools; multi-territory routing (Boston vs Maine gets one shared doc set for now); pricing automation.

## Decisions

- **D1 — Geography matching**: add `state` to `COMPANY_PROPERTIES`; `scoreCompany` matches each ICP geography (case-insensitive) against state, two-letter state code (via a US state-code map for the ~6 New England states + ME edge cases — actually a full 50-state map, it's 50 lines), or country. `geographies: ["Maine"]` is the initial ICP. Rationale: HubSpot small-business records fill `state` far more reliably than `country`.
- **D2 — ICP for event-hosting businesses**: industries drawn from HubSpot's standard picklist that map to breweries/venues/planners/hospitality (FOOD_BEVERAGES, HOSPITALITY, EVENTS_SERVICES, ENTERTAINMENT, RESTAURANTS, RECREATIONAL_FACILITIES_AND_SERVICES, CIVIC_SOCIAL_ORGANIZATION, WINE_AND_SPIRITS, HUMAN_RESOURCES); size 1–1000 (venues are small; corporate HR targets are bigger); personas: event/experience roles, taproom/venue managers, HR & people ops, office managers, owners/GMs.
- **D3 — Messaging**: 100-word cap, warm-but-plain tone, no pricing for Maine (delivery rates there aren't set — invite the conversation instead), Boston-area proof points allowed (real event types served), same banned-phrase list plus rental-industry clichés ("take your event to the next level").
- **D4 — Pricing in products.md but fenced**: full Boston rates and delivery tiers stay in the doc as context (they're public), with an explicit instruction that Maine quotes are conversations, not emails.

## Risks / Trade-offs

- [Gmail-style domains common at small venues → contacts excluded as excluded-domain/foreign-domain] → acceptable for v1: keeps the no-personal-email guarantee; revisit with an explicit allowlist property if Maine yield is too low.
- [State field empty on many records] → geography is one-third of icp-fit weight, not an exclusion; enrichment can backfill.
- [One doc set for two territories] → messaging explicitly frames the sender as "expanding into Maine"; fine until Boston prospecting wants different copy.

## Migration Plan

Docs + code land together; `npm test` guards scoring; redeploy bundles the new docs. Rollback = revert the commit.

## Open Questions

- Real proof points (named venues/events served, count of events per season) — placeholders marked `TODO` for Matt to fill.
- Maine service radius / which towns — marked `TODO` in company.md.
