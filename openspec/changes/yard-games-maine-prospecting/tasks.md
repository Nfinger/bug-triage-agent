## 1. Code: state-level geography

- [x] 1.1 Add `state` to `COMPANY_PROPERTIES` in `src/prospecting/crm.ts`
- [x] 1.2 Add a US state-code map and geography matching (state name, state code, or country; case-insensitive) in `src/prospecting/scoring.ts`
- [x] 1.3 Extend `tests/scoring.test.mjs`: "ME"/"Maine" both earn geography fit; country-only ICPs still work

## 2. Business docs

- [x] 2.1 Rewrite `docs/business/company.md`: Yard Games World identity, locations (Boston/Winthrop, South Shore, Worcester, new Maine), service model, proof points (TODOs where facts are needed)
- [x] 2.2 Rewrite `docs/business/products.md`: game catalog, packages/daily rates, delivery tiers, event types, guidance on which offering fits which prospect
- [x] 2.3 Rewrite `docs/business/icp.md`: Maine-expansion ICP JSON (industries, sizes, geographies ["Maine"], event-persona title patterns, excluded domains) + prose on who buys and who doesn't
- [x] 2.4 Rewrite `docs/business/messaging.md`: rules JSON (100-word cap, banned phrases incl. rental clichés) + voice, structure, never-do list, Maine-specific no-pricing rule

## 3. Verify

- [x] 3.1 `npm test` and `npm run check:types` pass (knowledge tests parse the real docs)
- [ ] 3.2 Reset the seeded Yard Games World test data (it's now our own company, not a prospect): mark it `do_not_prospect=true`; seed a realistic Maine prospect (e.g. a brewery with state ME and an SQL stage advance) and re-run draft mode
