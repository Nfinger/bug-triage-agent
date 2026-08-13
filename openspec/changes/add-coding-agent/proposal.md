# Add Coding Agent: GitHub Issue → Sandbox → Pull Request

## Why

Today the pipeline stops at a filed GitHub issue: Slack bug reports become triaged issues, but a human still has to pick each one up and write the fix. Adding a coding agent that takes an issue, works on it in an isolated Cloudflare sandbox, and opens a pull request closes the loop — routine fixes go from Slack report to reviewable PR with no human in the middle, while PR review keeps a human approval gate before anything merges.

## What Changes

- Add inbound GitHub webhook ingress: create the `@flue/github` channel route (`src/channels/github.ts` currently exports only an outbound Octokit client) and mount it at `/channels/github` so GitHub posts issue events to `/channels/github/webhook`, verified with `GITHUB_WEBHOOK_SECRET`.
- Dispatch label-gated: when an issue in the configured repository is labeled with the coding-agent label (`CODING_AGENT_LABEL`, default `agent-fix`), dispatch a new coding-agent conversation for that issue — exactly one agent instance per issue, with the webhook `deliveryId` as the idempotency key. The label works for triaged and manually created issues alike.
- Update the bug-triage agent to apply that label itself: after filing an issue, triage adds the coding-agent label (via a labeling step in the issue-filing tool) whenever the report describes a code-fixable bug in this repository — so Slack report → issue → coding agent → PR runs end-to-end with no human step. Triage skips the label for reports that aren't code fixes (questions, infra/outage reports, feature requests); a human can still hand-apply the label to anything, including manually filed issues.
- Create the coding agent (`src/agents/coding.ts`) as an **orchestrator**: it reads the issue (title, body, comments), attaches a Cloudflare sandbox via `useSandbox(cloudflareSandbox(...))`, clones the target repository, creates a work branch, and plans the fix — but delegates the actual code writing to subagents.
- Create worker subagents (`src/agents/coding-workers.ts`) declared on the orchestrator via `useSubagent(defineSubagent(...))`: an `investigator` (read-only exploration to locate the cause) and a `code-writer` (edits files and runs targeted checks for one scoped task). Subagents attach the **same per-issue sandbox** as the orchestrator (sandbox keyed by issue, shared via closure), so all delegated work lands in one shared working tree. The orchestrator alone validates the final result and publishes.
- Give the agent PR tools (`src/tools/github-pr.ts`): push the branch (token-authenticated git push from the sandbox) and open a pull request that references the issue (`Fixes #N`), then comment on the issue with the PR link. On failure (can't reproduce, checks fail, fix out of scope), comment on the issue explaining why instead of opening a PR.
- Add the Cloudflare sandbox integration via the `flue add sandbox cloudflare` blueprint: `@cloudflare/sandbox` dependency, `Sandbox` Durable Object export, container `Dockerfile`, and `wrangler.jsonc` bindings/migration.
- **BREAKING (deployment)**: switch the Flue target from `node` to `cloudflare` in `flue.config.ts`. The Cloudflare Sandbox integration requires the Cloudflare target; the app moves from a Node server to a Cloudflare Worker with a Durable Object–backed sandbox container. Local dev and deploy commands change accordingly.
- New configuration: `GITHUB_WEBHOOK_SECRET` (webhook verification), `CODING_AGENT_LABEL` (opt-in label, default `agent-fix`). Existing `GITHUB_TOKEN` gains a second use: git clone/push from inside the sandbox, so it needs contents read/write on the target repository.

## Capabilities

### New Capabilities

- `github-issue-intake`: Verified inbound GitHub webhook ingress — accept issue events, verify signatures, filter to the configured repository and coding-agent label, and dispatch each opted-in issue to the coding agent exactly once.
- `sandboxed-code-fixing`: The coding agent's work environment — one Cloudflare sandbox per issue, in which the repo is cloned, branched, edited, and checked; nothing is proposed from an unverified working tree.
- `code-writing-subagents`: Delegated implementation — the orchestrator hands scoped tasks to declared subagents (investigator, code-writer) through Flue's `task` tool; subagents work in the shared per-issue sandbox, report results back into the parent conversation, and never publish anything themselves.
- `pull-request-opening`: Publishing the result — push the work branch, open exactly one PR per issue linking back to it, report the PR (or a clear failure explanation) as an issue comment.

### Modified Capabilities

- `github-issue-filing`: The triage agent additionally applies the coding-agent label when the filed issue describes a code-fixable bug, handing it off to the coding agent automatically. (Capability introduced in the `add-slack-channel` change; new requirement added here, existing filing behavior unchanged.)

## Impact

- **New dependencies**: `@cloudflare/sandbox`; dev/deploy tooling for Cloudflare Workers (`wrangler`).
- **New code**: `src/agents/coding.ts`, `src/agents/coding-workers.ts`, `src/tools/github-pr.ts`, webhook handling in `src/channels/github.ts`, `cloudflare.ts` deployment module, `Dockerfile`, `wrangler.jsonc`.
- **Changed code**: `flue.config.ts` (target `node` → `cloudflare`), `src/app.ts` (mount GitHub channel), `src/channels/github.ts` (adds inbound channel alongside the existing Octokit client), `src/tools/github-issues.ts` (filing tool gains a labeling step), `src/agents/bug-triage.ts` (instructions on when to apply the coding-agent label).
- **External systems**: GitHub repository webhook configured for `issues` events pointing at the deployed `/channels/github/webhook` URL with the shared secret; `GITHUB_TOKEN` scope widened to repo contents read/write + pull requests; Cloudflare account with Workers, Durable Objects, and Containers enabled.
- **Deployment**: the app no longer runs as a plain Node process — it deploys with `wrangler` to Cloudflare. This affects how Slack/GitHub webhook URLs are exposed and how secrets are provided (wrangler secrets instead of process env files).
