# Design: Coding Agent (Issue → Cloudflare Sandbox → PR)

## Context

The app is a Flue project (target `node`) with one pipeline: Slack bug channel → `BugTriage` agent → GitHub issue. GitHub access is outbound-only — `src/channels/github.ts` exports an authenticated Octokit client but deliberately mounts no webhook route. This change adds the downstream half: a coding agent that picks up an issue, fixes it in an isolated environment, and opens a PR.

The chosen sandbox is Flue's Cloudflare Sandbox integration (`@cloudflare/sandbox` + `cloudflareSandbox()` from `@flue/runtime/cloudflare`), per <https://flueframework.com/docs/ecosystem/sandboxes/cloudflare/>. Its documented requirements: Cloudflare target (not Node), a container `Dockerfile`, a `Sandbox` Durable Object binding in `wrangler.jsonc` with a migration, and the DO exported from the deployment module.

## Goals / Non-Goals

**Goals:**
- A human labels an issue (`agent-fix` by default) and, with no further input, gets either a PR that passes the project's checks or an issue comment explaining why not.
- One conversation, one sandbox, one branch, at most one PR per issue — idempotent under webhook redelivery.
- The whole app runs on Cloudflare Workers so the sandbox integration is native.

**Non-Goals:**
- Auto-merge or any bypass of PR review; the PR is where the human gate lives.
- Attempting fixes for every issue regardless of kind — triage labels only reports it judges code-fixable; questions, feature requests, and infra reports are filed without the label.
- Responding to PR review comments with revisions (a natural follow-up change, not this one).
- Multi-repository support — `GITHUB_REPO` stays the single configured target.

## Decisions

### D1: Trigger via GitHub webhook on `issues.labeled`; triage applies the label
The coding agent starts when the `issues` webhook reports the configured label was applied. The label normally comes from the triage agent itself: after filing, it labels issues it judges code-fixable (questions, feature requests, and infra reports are filed unlabeled). Humans can also apply the label by hand — to manually created issues, or to anything triage skipped.

- *Why route through the label instead of triage dispatching the coding agent directly*: the label keeps the agents decoupled (they communicate only through GitHub state), makes the hand-off visible and auditable on the issue, covers hand-filed issues with the same mechanism, and leaves a manual override in both directions — a human can label to opt in, and the judgment gate in triage keeps obviously non-code issues out.
- *Labeling mechanics*: the filing tool applies the label with a separate `issues.addLabels` call after creation (not `labels` on the create call), guaranteeing a distinct `issues.labeled` delivery for the webhook to react to. A labeling failure doesn't void the filing — the tool reports the created issue plus the labeling error.
- *Alternatives*: (a) direct agent-to-agent hand-off after filing — rejected: invisible coupling, misses manually filed issues, and Flue steers cross-agent work through channels/subagents rather than peer dispatch. (b) Trigger on `issues.opened` for all issues — rejected: attempts fixes on non-code issues, and labels applied at creation wouldn't gate anything. (c) Human-only labeling (original design) — dropped by user direction in favor of an end-to-end automatic pipeline; the PR review remains the human gate.

### D2: Migrate the app target from `node` to `cloudflare`
`flue.config.ts` switches to `target: 'cloudflare'`; the app deploys as a Worker with `wrangler`, with a `cloudflare.ts` deployment module exporting `export { Sandbox } from '@cloudflare/sandbox'`, a project-root `Dockerfile` for the container image (tag matched to the installed package version), and DO/container bindings plus a migration in `wrangler.jsonc`. The `flue add sandbox cloudflare` blueprint scaffolds most of this.

- *Why*: the Cloudflare Sandbox integration explicitly requires the Cloudflare target; the user chose this provider. Hono routes and both channels are runtime-agnostic, so app code is unaffected — this is a deployment-layer migration.
- *Alternatives*: keep `node` and use a node-compatible sandbox provider (Daytona, E2B, Modal, Vercel) — rejected: contradicts the explicit choice of Cloudflare sandboxes. Split deployment (node app + separate CF worker for the agent) — rejected: two deploy targets and cross-service dispatch for no benefit at this size.
- *Consequence*: secrets move from process env files to `wrangler secret`/`.dev.vars`; the Slack webhook URL changes to the Worker's URL (external reconfiguration, no code change).

### D3: One sandbox per issue, keyed by the issue and shared with subagents
`useSandbox(cloudflareSandbox(getSandbox(env.Sandbox, sandboxKey)), { cwd: '/workspace' })`, where `sandboxKey` is derived from `owner/repo#issueNumber` — not from the conversation id. The orchestrator computes the key from its initial data; worker subagents receive it by closure (Flue subagent functions take no props, so shared values are closed over) and attach the same Durable Object–backed container.

- *Why*: issue-scoped identity gives isolation between issues while letting the orchestrator and all its subagents operate on one working tree — a subagent's edits are immediately visible to the parent with no copying or artifact hand-off. It also survives conversation resumption.
- *Alternative*: sandbox per conversation (orchestrator and each subagent isolated) — rejected: subagents would need to ship diffs back through task results and the parent would have to re-apply them; shared workspace is simpler and matches how a human team shares a checkout.

### D3b: Orchestrator + worker subagents via `useSubagent`
The coding agent is an orchestrator that plans and validates but delegates implementation. It declares subagents with `useSubagent(defineSubagent({ name, description, agent }))` — Flue's native delegation mechanism, where the parent's model invokes workers by name through the framework-injected `task` tool and child conversations are retained on the parent for inspection:

- `investigator` — read-only exploration: locate the cause, map the relevant code, report findings. No expectation of edits.
- `code-writer` — implements one scoped task in the shared sandbox: edit the named files, run targeted checks, report what changed and what passed.

The orchestrator gives each task an explicit scope and never runs overlapping `code-writer` tasks concurrently (single working tree). Publishing tools (PR, issue comments) are bound only to the orchestrator; after delegation completes it runs the full check suite itself before pushing.

- *Why*: separating planning/validation from implementation keeps the orchestrator's context small on large diffs, lets exploration and writing use differently tuned models (`model`/`thinkingLevel` per `defineSubagent`), and puts a natural review point between "code written" and "code published". `useSubagent` is Flue's sanctioned pattern — direct agent-to-agent `dispatch()` is not (delegation must go through the task tool), and it would also lose the parent-retained child conversations.
- *Alternatives*: single agent doing everything itself — rejected per user direction, and it couples one context window to the whole fix; peer agents wired with `dispatch()` from tools — rejected: fire-and-forget receipts with no result flow back into the caller's conversation, and Flue's docs steer delegation to `useSubagent`.

### D4: Git operations run in the sandbox; publishing goes through bound tools
Clone/branch/commit/check-running happen as sandbox `exec` calls driven by the agent's instructions (clone with `GITHUB_TOKEN` embedded only in the remote URL or via a credential helper, never committed). Opening the PR and commenting on the issue are `defineTool` tools (`src/tools/github-pr.ts`) using the existing Octokit client, mirroring how `github-issues.ts` tools work.

- *Why*: shell-in-sandbox is the natural interface for code work, while typed tools keep the irreversible, external-facing actions (push+PR, comments) structured, validated (repo fixed by config, not model-chosen), and observable in the conversation — same safety posture as issue filing today.
- *Alternatives*: do the push via Octokit's git-data API — rejected: recreating commits blob-by-blob is complexity for nothing when git is right there in the container. Have the model call `gh pr create` in the sandbox — rejected: loses the fixed-repo guardrail and structured error reporting.

### D5: The PR tool is idempotent per conversation
`open_pull_request` records/derives the branch name from the issue number, uses `Fixes #<n>` in the body, and if a PR for that head branch already exists, returns the existing PR instead of failing — the instruction mirror of "exactly one issue per thread" in the triage agent.

### D6: Prompt-level workflow contract
The orchestrator's instructions encode the loop: read issue → delegate investigation (`task` → `investigator`) → branch → delegate implementation in scoped chunks (`task` → `code-writer`) → run the full checks itself (`npm run check:types` at minimum, tests if present in the target repo) → push+PR via tool → comment. Explicit failure path: comment on the issue and stop. Worker instructions mirror the contract from the other side: do only the scoped task, report changes and check results, never publish. Model choice mirrors the existing agent's configured provider (kept in one place so it's easy to swap; workers can override via `defineSubagent`'s `model`).

## Risks / Trade-offs

- [Target migration breaks existing deployment] → The Slack pipeline is re-verified end-to-end on the Worker before the change is considered done; rollback is reverting `flue.config.ts` + deploy config, since app code stays runtime-agnostic.
- [Agent burns tokens/compute on unfixable issues] → Triage's judgment gate keeps non-code reports unlabeled; volume is bounded by the Slack bug channel's report rate; instructions cap the attempt (report failure rather than loop); checks must pass before any PR exists. If auto-labeling proves too eager in practice, tightening triage's labeling criteria (or reverting to human-only labeling) is a prompt-level change.
- [Token leakage via sandbox shell] → Token is injected only into git remote config/credential helper; spec requires pushed history free of credentials; the PR/comment tools never accept a token parameter.
- [Webhook redelivery double-triggers work] → Instance id per issue + delivery id as idempotency key; PR tool idempotent per D5.
- [Container cold start/limits on Cloudflare] → Acceptable for a background fix task (minutes-scale latency is fine); Dockerfile pins the toolchain so installs are cached in the image.
- [Concurrent subagents clobber the shared working tree] → Orchestrator instructions require disjoint scopes for parallel `code-writer` tasks (spec'd in `code-writing-subagents`); when in doubt, delegate sequentially.
- [Delegation loops or runaway subagent spend] → Flue's delegation-depth cap bounds nesting; workers get narrow task briefs and no publishing tools, so a stuck worker can waste one task, not the pipeline.

## Migration Plan

1. Land code + config behind the existing deploy (no webhook configured → coding agent dormant).
2. Deploy Worker with `wrangler`; set secrets (`SLACK_SIGNING_SECRET`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, ids/labels).
3. Repoint the Slack Events API URL at the Worker; verify the existing triage pipeline still works.
4. Add the GitHub repo webhook (`issues` events) with the secret; create the `agent-fix` label.
5. Label a known-simple issue; watch the run end-to-end.
- Rollback: remove the GitHub webhook (disables the new pipeline instantly); if the target migration itself misbehaves, redeploy the previous node build and repoint the Slack URL back.

## Open Questions

- Which model should power the coding agent? (Defaulting to the same OpenRouter provider already configured for triage; a stronger coding model is a one-line change in `src/agents/coding.ts`.)
- Does the target repo's CI need a convention for agent branches (e.g. skip heavy jobs on `agent/*`)? Deferred until real usage shows cost.
