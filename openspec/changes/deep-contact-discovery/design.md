# Design: Deep Contact Discovery

## Context

Discovery today is fetch-and-search only. LinkedIn (where names/titles live) blocks fetches, snippets are inadmissible, and companies like Point Lookout publish no on-domain email — so a run can know a company is a fit and still have no path to a person. Hunter.io licenses exactly this data: domain-search (people at a domain) and email-finder (address for a name), both returning confidence scores.

## Goals / Non-Goals

**Goals:** turn "nobody emailable" into either a verified contact or a named lead in the skip record; keep every anti-fabrication guardrail code-enforced.
**Non-Goals:** LinkedIn scraping (ToS-violating and technically blocked); email pattern guessing (bounce risk, violates "never invent"); prospecting the management company (separate change); any change to outreach linting — snippets stay inadmissible for message claims.

## Decisions

1. **Verified emails live in a code-owned registry.** The Hunter tool records passing results in `context.verifiedEmails` (email → name/title/score/source), mirroring the `fetchedUrls` pattern. `create_contact` accepts an email iff it's page-evidenced (existing path) or in this registry with a loosely-matching name. The model can read results but cannot write the registry — a hallucinated address still cannot become a contact.
2. **Threshold and caps in code, not prompt.** Only results with score/confidence ≥ `HUNTER_MIN_SCORE` (default 80) and an exact domain match are recorded; lower scores are returned as information flagged unverified. Lookups are budgeted per company (`HUNTER_LOOKUPS_PER_COMPANY`, default 2) via a new `lookups` kind on `ResearchBudget` (not increased by the discovery bonus).
3. **Key-gated tool registration.** `find_contact_email` is only `useTool`'d when `HUNTER_API_KEY` is set, and the prompt's discovery playbook mentions it conditionally — no phantom tool, and keyless deploys behave exactly as today.
4. **One tool, two Hunter endpoints.** With a name → email-finder (targeted); without → domain-search returning up to 5 personal-type addresses. Generic addresses (info@) are reported but never auto-verified — emailing role mailboxes is a product decision this change does not make.
5. **Snippet leads are prompt-level.** No new code path: the playbook instructs using snippet names as leads for lookups and requiring skip summaries to name leads found. Enforcement lives where it already is — `create_contact` and the send linter.

## Risks / Trade-offs

- [Provider data can be stale → bounces] → threshold 80+, domain must match, and sending is currently draft-mode; hard-bounced contacts are already excluded from future sends.
- [Hunter costs per lookup] → per-company cap (2) and only during discovery; free tier suffices to evaluate.
- [Name mismatch between snippet and Hunter record] → create_contact requires the created name to match Hunter's record for that address (case-insensitive); on mismatch the agent must use Hunter's version or not create.
- [Key absent in prod until user adds it] → graceful: tool unregistered, behavior identical to today.

## Migration Plan

Deploy via CI; user creates the Hunter account and sets `HUNTER_API_KEY` (`npx wrangler secret put HUNTER_API_KEY --name bug-triage-agent`). Rollback: remove the secret (tool disappears) or revert.

## Open Questions

None.
