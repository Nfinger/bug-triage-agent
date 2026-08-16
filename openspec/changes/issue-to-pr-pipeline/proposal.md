# Issue-to-PR Pipeline

## Why

Issues labeled `agent-fix` are supposed to be picked up by an automated coding agent that lands a fix as an open pull request, but no agent has ever completed that journey. The clearest evidence is marketsavvy issue #476: an agent investigated, implemented, and validated a correct fix, then died at the last mile — the token had no write access to the repository, so `git push` and the PR-creation API both failed, and the work was stranded as an issue comment describing a local commit. This app currently has no inbound GitHub channel, no coding agent, and no push/PR capability at all; the gap from "issue filed" to "PR open" is entirely unbuilt.

## What Changes

- Add a verified GitHub webhook channel (`POST /channels/github/webhook`) that reacts when an issue is labeled `agent-fix` in the configured repository and dispatches a new coding agent, one durable conversation per issue.
- Add a `CodingFix` agent that works in a real workspace (local sandbox): clones the target repository into a per-issue working directory, implements the fix on a dedicated branch (`agent/issue-<n>`), and runs the repo's validation (lint/typecheck/tests) before delivering.
- Add branch-push and open-PR tools so the agent can deliver its work: push the branch to the target repository and open a pull request that references the issue (`Fixes #<n>`), then comment the PR link back on the issue.
- Add a credential preflight: before any fix work starts, verify the token actually has push permission on the target repository. If it doesn't, comment the actionable error on the issue immediately and stop — never repeat the #476 failure mode of discovering missing write access only after the fix is built.
- Expand documented `GITHUB_TOKEN` requirements from Issues-only to include **Contents: Read and write** and **Pull requests: Read and write**, and add `GITHUB_WEBHOOK_SECRET` plus workspace configuration to `.env.example` and the README setup guide.

## Capabilities

### New Capabilities

- `github-channel`: Verified GitHub webhook ingress — signature checking, filtering to `agent-fix` label events on issues in the configured repository, idempotent dispatch to the coding agent with one conversation per issue.
- `issue-fix-agent`: The coding agent's work loop — workspace setup (clone, branch), implementing a fix scoped to the issue, running repository validation, and reporting honestly when it cannot produce a fix.
- `pr-delivery`: Getting finished work out — credential preflight for push permission, pushing the fix branch, opening exactly one PR per issue that references it, linking the PR back on the issue, and surfacing delivery failures as issue comments instead of silent stalls.

### Modified Capabilities

_None — Slack intake, triage, and issue filing behavior are unchanged. (The `agent-fix` label is applied by humans opting an issue in, as today.)_

## Impact

- **New code**: `src/agents/coding-fix.ts`, `src/tools/github-pr.ts` (push/PR/preflight tools), `src/channels/github.ts` grows from an outbound-only Octokit client into a full `@flue/github` channel with a webhook handler; `src/app.ts` mounts the channel.
- **Configuration**: new `GITHUB_WEBHOOK_SECRET` and a workspace root for clones (e.g. `AGENT_WORKSPACE_DIR`); `GITHUB_TOKEN` must be re-issued with Contents + Pull requests read/write on the target repo — the current Issues-only token is exactly what stranded #476.
- **External setup**: a repository webhook on the target repo (issues events, JSON, secret-signed) pointing at `/channels/github/webhook`.
- **Runtime**: the coding agent uses Flue's `local()` sandbox on the Node target — it runs real `git` and shell commands on the host, so deployment inherits the host-isolation caveats documented by Flue (run it on a dedicated/containerized host).
- **Dependencies**: none new beyond what's installed (`@flue/github`, `@octokit/rest` already present).
