# Tasks: Add Coding Agent

## 1. Cloudflare target migration

- [x] 1.1 Run `flue add sandbox cloudflare` and review what the blueprint scaffolds (`@cloudflare/sandbox` dependency, `Dockerfile`, `wrangler.jsonc` container/DO binding + migration, deployment module)
- [x] 1.2 Switch `flue.config.ts` to `target: 'cloudflare'` and add/verify `cloudflare.ts` deployment module with `export { Sandbox } from '@cloudflare/sandbox'`
- [x] 1.3 Verify the Dockerfile image tag matches the installed `@cloudflare/sandbox` version and the container has git + Node toolchain
- [x] 1.4 Confirm the existing app still builds and runs locally on the Cloudflare target (`npm run check:types`, local dev server responds on `/agents/hello/...` and `/channels/slack/events`)

## 2. GitHub webhook intake

- [x] 2.1 Extend `src/channels/github.ts` with the inbound `@flue/github` channel: create the channel with `GITHUB_WEBHOOK_SECRET`, keep exporting the Octokit client, and update the outdated "outbound-only" comment
- [x] 2.2 In the webhook handler, filter to `issues` events with action `labeled`, label matching `CODING_AGENT_LABEL` (default `agent-fix`), and repository matching `GITHUB_REPO`; ignore everything else
- [x] 2.3 Dispatch the coding agent with instance id derived from `owner/repo#issueNumber`, `deliveryId` as idempotency key, and initial data `{ owner, repo, issueNumber, title }`; pass the issue body as the signal
- [x] 2.4 Mount the channel in `src/app.ts` at `/channels/github`

## 3. Coding agent, subagents, and sandbox

- [x] 3.1 Create `src/agents/coding.ts` (orchestrator): `useModel(...)`, `useInitialData` with a valibot schema for the issue ref, sandbox key derived from `owner/repo#issueNumber`, `useSandbox(cloudflareSandbox(getSandbox(env.Sandbox, sandboxKey)), { cwd: '/workspace' })`
- [x] 3.2 Create `src/agents/coding-workers.ts`: factory functions returning `investigator` (read-only exploration) and `code-writer` (scoped edits + targeted checks) agent functions that close over the issue's sandbox key and attach the same sandbox; no publishing tools bound
- [x] 3.3 Declare the workers on the orchestrator via `useSubagent(defineSubagent({ name, description, agent }))`, with optional per-worker `model`/`thinkingLevel` overrides
- [x] 3.4 Write the orchestrator instructions encoding the workflow: read the issue, clone `GITHUB_REPO` (token via credential helper only), branch `agent/issue-<n>` off the default branch, delegate investigation then scoped implementation tasks via the `task` tool (disjoint scopes, sequential when in doubt), run the full project checks itself, and only then publish; on failure, comment on the issue and stop (workspace setup runs in the harness-backed `setup_workspace` tool so the token never enters the conversation)
- [x] 3.5 Write the worker instructions: do only the briefed task in the shared working tree, report files changed and check results, never push/PR/comment
- [x] 3.6 Ensure the clone/push authentication path cannot end up in commits (git config/credential helper approach, no token in files)

## 4. Triage hand-off (auto-labeling)

- [x] 4.1 Extend `fileGithubIssue` in `src/tools/github-issues.ts` with an optional `handOffToCodingAgent` input: when true, apply `CODING_AGENT_LABEL` via a separate `issues.addLabels` call after creation; a labeling failure still returns the created issue number/URL alongside the labeling error
- [x] 4.2 Update `src/agents/bug-triage.ts` instructions: set the hand-off flag for reports describing a code-fixable bug in this repository; leave it unset for questions, feature requests, and infra/outage reports
- [x] 4.3 Unit-style check of the tool: creation success + label failure surfaces both facts in the tool output

## 5. PR tools

- [x] 5.1 Create `src/tools/github-pr.ts` with `open_pull_request`: pushes are done by the agent in the sandbox; the tool creates the PR against the default branch with `Fixes #<n>` body, and returns the existing PR if one is already open for the head branch (idempotent); also `setup_workspace` (harness-backed clone/branch with credential-store auth)
- [x] 5.2 Add `comment_on_issue` reuse: wire the existing `comment_on_github_issue` tool from `src/tools/github-issues.ts` into the coding agent for success/failure reporting
- [x] 5.3 Follow the existing tool error convention: catch API errors and return `{ ok: false, error }` so failures surface in the conversation

## 6. Configuration and deployment

- [x] 6.1 Document and wire new env/secrets: `GITHUB_WEBHOOK_SECRET`, `CODING_AGENT_LABEL` (default `agent-fix`); note widened `GITHUB_TOKEN` scope (contents read/write + pull requests) in README
- [x] 6.2 Add `.dev.vars`/`wrangler secret` setup for all existing secrets (`SLACK_SIGNING_SECRET`, `SLACK_BUG_CHANNEL_ID`, `GITHUB_TOKEN`, `GITHUB_REPO`) on the Cloudflare target
- [x] 6.3 Update README: new pipeline diagram (Slack → triage → labeled issue → coding agent → PR), Cloudflare deployment instructions, GitHub webhook setup (`issues` events → `/channels/github/webhook`), and label creation

## 7. Verification

- [x] 7.1 Type-check and build (`npm run check:types`, `npm run build`)
- [x] 7.2 Local webhook test: POST a signed `issues.labeled` fixture to `/channels/github/webhook`; verify dispatch on label match and silence on non-matching label/repo/action
- [x] 7.3 Redelivery test: POST the same fixture twice; verify the second delivery is a no-op (idempotency key)
- [x] 7.4 End-to-end: post a bug report in the Slack channel and verify the full chain unattended — triage files the issue with the coding-agent label, the coding agent produces a branch with passing checks, exactly one PR with `Fixes #<n>`, and a PR-link comment on the issue _(verified locally: Worker on `vite dev` + ngrok tunnel against Stock-GPT/marketsavvy — Slack report → issue #481 auto-labeled → PR #485 "Fixes #481" → "Fixed in #485" comment; re-verify after first real deploy)_
- [x] 7.5 Delegation check on that run: the orchestrator delegated investigation and implementation to `investigator`/`code-writer`, whose work (root-cause analysis, scoped edits, targeted checks) landed in the shared sandbox working tree and surfaced in the run reports _(verified via run behavior and reports; conversation-level inspection deferred)_
- [x] 7.6 Hand-labeling path: apply the label by hand to an existing issue, verify the coding agent picks it up the same way _(verified: hand-labeled #476 → agent investigated, fixed, validated with repo checks, and reported)_
- [x] 7.7 Regression: verify a non-code Slack report is filed without the label and triggers no coding agent _(verified three times: #482 vague, #483 truncated, #484 operational — all filed unlabeled, no dispatch)_
