# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/app.ts` — the route map; every route is mounted here explicitly.
- `src/db.ts` — the persistence adapter for durable conversations.
- `src/schedules/` — cron-dispatched runs (`src/cloudflare.ts` routes each fire by cron expression).
- `src/prospecting/` — the prospecting run's model-free parts: config, business-doc parsing, scoring, contact eligibility, send ledger. `docs/business/*.md` is the agent's knowledge of the business and is bundled at build time.
- `src/tools/` — tool definitions; guardrails (what the model may read, write, or send) belong here, not in prompts.

## Commands

- `npx flue run src/agents/bug-triage.ts --message "Hi"` — run an agent locally, no server.
- `npm run dev` — start the dev server.
- `npm run build` — build `dist/server.mjs` (start it with `npm run start`).
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.
