# Tasks: Issue-to-PR Pipeline

## 1. Configuration & credentials

- [x] 1.1 Add `GITHUB_WEBHOOK_SECRET` and `AGENT_WORKSPACE_DIR` to `.env.example` with comments; document the expanded `GITHUB_TOKEN` scopes (Issues, Contents, Pull requests — all read/write)
- [x] 1.2 Update README: expanded token setup, webhook creation steps (issues events, JSON content type, secret) pointing at `/channels/github/webhook`, `agent-fix` opt-in flow, and the dedicated/containerized-host caveat for the local sandbox

## 2. GitHub webhook channel

- [x] 2.1 Rework `src/channels/github.ts`: keep the `client` export, add `createGitHubChannel({ webhookSecret, webhook })` filtering to `issues`/`labeled`/`agent-fix` events on the configured repo (reuse `targetRepo()` parsing — extract it to a shared module)
- [x] 2.2 Dispatch `CodingFix` from the webhook with `id: channel.instanceId({owner, repo, issueNumber})`, `idempotencyKey: delivery.deliveryId`, initialData carrying repo + issue number/title, and a signal message carrying the issue body
- [x] 2.3 Mount the channel in `src/app.ts` at `/channels/github`

## 3. Delivery tools (`src/tools/github-pr.ts`)

- [x] 3.1 Implement `preflightPushAccess`: check `GET /repos/{owner}/{repo}` `permissions.push` with the configured token; return `{ok: false, error}` naming the missing scopes when absent
- [x] 3.2 Implement `prepare_workspace` (harness-side): clone the target repo into `AGENT_WORKSPACE_DIR/<owner>-<repo>-issue-<n>` (or reuse the existing clone), create/checkout `agent/issue-<n>` from the default branch
- [x] 3.3 Implement `push_branch`: token-authenticated push of `agent/issue-<n>` to the target repo; `{ok:false, error}` on rejection, never throw
- [x] 3.4 Implement `open_pull_request`: create PR from `agent/issue-<n>` into the default branch with a body containing `Fixes #<n>`, summary, and validation results; return the PR URL; repo and base branch come from configuration, not model input

## 4. CodingFix agent (`src/agents/coding-fix.ts`)

- [x] 4.1 Create the agent with `useSandbox(local(), { cwd: <per-issue dir> })`, the delivery tools, and `comment_on_github_issue`
- [x] 4.2 Write instructions enforcing the pipeline order: preflight first (stop and comment on failure) → prepare workspace → implement scoped fix → run repo lint/typecheck/tests → push → open exactly one PR per conversation → comment PR URL on the issue; on any blocker, comment findings honestly and never claim undelivered work
- [x] 4.3 Handle repeat triggers: instructions + retained PR number ensure a re-applied label never opens a second PR

## 5. Validation

- [x] 5.1 `npm run check:types` passes
- [x] 5.2 Local webhook simulation: signed `issues.labeled` payload for `agent-fix` dispatches the agent; wrong label, wrong repo, and bad signature do not; redelivered delivery ID is a no-op
- [x] 5.3 Preflight test with an issues-only token: issue receives the actionable permission comment and no clone happens — *adapted: token was re-scoped before testing, so only the passing path was verified live (`permissions.push: true` on the target repo); the rejection path is covered by code review and the tool's simulated `ok:false` handling*
- [x] 5.4 End-to-end against a sandbox repo: file a toy issue, label it `agent-fix`, verify an open PR with `Fixes #<n>` appears and the issue gains the PR link — *adapted: `GITHUB_REPO` was configured directly at the real repo, so 5.4 and 5.5 were combined into one live run*
- [x] 5.5 Acceptance: re-run against marketsavvy#476 (with the re-scoped token) and confirm the fix lands as an open PR — *PR #496 opened from `agent/issue-476` into `main` with `Fixes #476`, validation summary, and a link-back comment on the issue*
