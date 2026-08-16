# Design: Issue-to-PR Pipeline

> **Outcome note (2026-08-16):** this design was written and fully implemented against a
> stale checkout on the Node target (`local()` sandbox, child_process git), and that
> implementation proved the loop end-to-end: marketsavvy#476 → open PR #496. Meanwhile
> `main` had independently grown a Cloudflare-native implementation of the same pipeline
> (per-issue Cloudflare sandbox, investigator/code-writer subagents, deploy CI). The Node
> implementation was not merged; instead its distinguishing pieces were ported onto the
> Cloudflare implementation: the `preflight_push_access` credential gate (also enforced
> inside `setup_workspace`), the re-scoped `GITHUB_TOKEN`, and
> `scripts/simulate-label-webhook.mjs`. The specs in this change describe pipeline
> behavior and remain normative; the decisions below describe the superseded Node
> architecture and are kept as a record. The full Node implementation survives on the
> `holy-element` branch.

## Context

The bug-triage half of the system works: Slack reports become GitHub issues. The fix half doesn't exist in this app — issues labeled `agent-fix` are meant to be picked up by a coding agent, and no attempt has ever ended in an open PR. The post-mortem on marketsavvy#476 shows the failure was not intelligence but plumbing: an agent produced a correct, validated, locally-committed fix and then hit "Write access to repository not granted" on both `git push` and the PR API, because the token only had issue scopes. This change builds the pipeline inside this Flue app, where credentials, ingress, and delivery are owned and testable.

Current relevant state:
- `src/channels/github.ts` is outbound-only (an Octokit client for issue filing); the comment there explicitly notes no inbound webhook channel exists.
- `@flue/github` and `@octokit/rest` are already dependencies; the `flue add channel github` blueprint pattern (createGitHubChannel + webhook handler + dispatch) is the documented shape.
- Flue's `local()` sandbox (Node target) is the documented fit for coding agents: real filesystem, real `git`, real shells.

## Goals / Non-Goals

**Goals:**
- An issue labeled `agent-fix` in `GITHUB_REPO` reliably ends in either (a) an open PR that fixes it, linked from the issue, or (b) a prompt, actionable comment on the issue explaining why not.
- Fail fast on credentials: the #476 class of failure is detected before any fix work, not after.
- Durable, idempotent processing: one conversation per issue, at most one PR per issue, webhook redeliveries are no-ops.

**Non-Goals:**
- Auto-applying the `agent-fix` label (opt-in stays human).
- Merging PRs, responding to PR review comments, or iterating on CI feedback after the PR opens (future change).
- Multi-repository support beyond the single configured `GITHUB_REPO`.
- Sandboxed/containerized isolation of the coding agent's shell — we use `local()` and document the host requirements.

## Decisions

### D1: Grow `src/channels/github.ts` into a full `@flue/github` channel
Replace the outbound-only module with `createGitHubChannel({ webhookSecret, webhook })` while keeping the existing `client` export so the issue-filing tools are untouched. The webhook handler filters to `issues`/`labeled`/`agent-fix`/configured-repo and dispatches `CodingFix` with `id: channel.instanceId({owner, repo, issueNumber})` and `idempotencyKey: delivery.deliveryId`.
*Alternative considered:* a separate polling loop (no webhook setup needed) — rejected: adds latency and a scheduler, and the blueprint's verified-webhook path is the supported pattern and matches the existing Slack channel's architecture.

### D2: `CodingFix` agent on a `local()` sandbox with per-issue cwd
The agent uses `useSandbox(local(), { cwd: <AGENT_WORKSPACE_DIR>/<owner>-<repo>-issue-<n> })` so each issue conversation gets a stable, durable working directory — a re-triggered conversation lands back in its own clone. Workspace preparation (clone + branch) is done by a harness-side setup tool rather than trusting the model to run the right git incantations.
*Alternative considered:* virtual (in-memory) sandbox — rejected: no real git, cannot run the target repo's toolchain. Remote provider sandbox (e.g. Vercel) — rejected for now: extra service and credentials; `local()` is the documented fit for self-hosted coding agents, and this app already targets Node.

### D3: Delivery is tool-mediated, not free-form shell
Push and PR-open are dedicated tools (`push_branch`, `open_pull_request`) in `src/tools/github-pr.ts` built on the shared Octokit client and token-authenticated git. Tools return `{ok: false, error}` on failure (same convention as the issue tools) so the agent must see and report failures — the spec forbids claiming delivery that didn't happen. The repo and base branch come from configuration; the model never chooses where to push.
*Alternative considered:* let the agent `git push` and `gh pr create` in bash — rejected: credentials would have to live in the sandbox environment, failures are stringly-typed, and the once-per-conversation PR guarantee is easier to state and check on a tool.

### D4: Preflight as a hard gate in the dispatch path
Before the agent does any work (first message of a conversation), a preflight checks `GET /repos/{owner}/{repo}` for `permissions.push` with the configured token. On failure it comments the exact missing scopes on the issue and the run ends. Implemented as the first mandatory tool step in the agent's instructions, backed by a harness check, so it cannot be skipped by the model.
*Alternative considered:* startup-time validation only — kept as a bonus (log a warning at boot), but not sufficient: tokens expire and get rotated while the server runs; the per-issue gate is what protects each run.

### D5: Single `GITHUB_TOKEN`, expanded scopes
Reuse the existing `GITHUB_TOKEN` variable with expanded fine-grained scopes (Issues R/W, Contents R/W, Pull requests R/W) rather than adding a second token. One credential, one setup step, one preflight.
*Alternative considered:* separate `GITHUB_CODING_TOKEN` for least privilege on the triage path — rejected: both tokens would point at the same repo, and the operational cost of two rotating credentials outweighs the marginal privilege separation. Revisit if triage and fixing ever target different repos.

### D6: Branch and PR conventions
Branch `agent/issue-<n>` (matches the convention the #476 attempt already used), PR from that branch into the default branch, body containing `Fixes #<n>`, the change summary, and validation results. The agent comments the PR URL back on the issue as its final act.

## Risks / Trade-offs

- [`local()` runs model-directed shell on the host] → Document (README + proposal) that the server must run on a dedicated or containerized host; the sandbox is not an isolation boundary. The target repo's code executes during validation, so this is equivalent to running that repo's CI locally.
- [Long-running fix work vs. webhook timeout] → Dispatch is async (webhook acknowledges immediately; the agent runs in the background) — this is Flue's normal dispatch model, same as the Slack channel.
- [Clone/workspace accumulation on disk] → Per-issue directories are stable and reused; document `AGENT_WORKSPACE_DIR` cleanup as an operational task. Acceptable at bug-fix volume.
- [Model opens a wrong or low-quality PR] → Validation gate (lint/typecheck/tests) before delivery, PR is a reviewable artifact (nothing merges automatically), and scope is constrained by instructions + spec.
- [Label re-applied after PR opened] → Same conversation receives the event; instructions + once-per-conversation PR rule prevent duplicates (mirrors the one-issue-per-thread pattern proven in BugTriage).

## Migration Plan

1. Re-issue the fine-grained PAT with Contents + Pull requests + Issues read/write on the target repo; update `GITHUB_TOKEN`.
2. Deploy the new channel; add `GITHUB_WEBHOOK_SECRET` and `AGENT_WORKSPACE_DIR`.
3. Create the repository webhook (issues events, JSON, secret) pointing at `<base-url>/channels/github/webhook`.
4. Validate end-to-end against a sandbox repository first (same guidance the README already gives for issue filing), then point at the real repo and re-label marketsavvy#476 as the acceptance test — the stranded fix should arrive as an open PR.

Rollback: delete the repository webhook (or stop mounting the channel route); triage/filing is unaffected.

## Open Questions

- Should the preflight also verify the default branch is not protected against the token's pushes (branch protection rules can pass the permission check but still reject the push)? Leaning yes-later: the push-failure path already surfaces it on the issue.
- Model choice for `CodingFix` (triage runs kimi-k2.6; a stronger coding model may be warranted). Default to the same provider config and tune after first real runs.
