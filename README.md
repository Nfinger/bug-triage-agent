# bug-triage-agent

A [Flue](https://flueframework.com) agent project that reads bug reports from a Slack channel, triages them with an agent, and files each one as a GitHub issue (follow-up thread replies become comments on the issue).

How it flows: Slack Events API → `POST /channels/slack/events` (signature-verified) → `src/channels/slack.ts` filters to plain user messages in the bug channel → dispatches to the `BugTriage` agent (one conversation per Slack thread, deduped on Slack's `event_id`) → the agent summarizes the report and calls `file_github_issue` / `comment_on_github_issue` (`src/tools/github-issues.ts`).

## Setup

```sh
npm install
```

Then add a model provider API key to `.env` (any [provider Pi supports](https://pi.dev/docs/latest/providers#api-keys)). Copy `.env.example` for the full list of variables this app needs. This app targets Cloudflare Workers (`flue.config.ts`), so local dev runs in workerd via `vite dev`; if you'd rather keep local variables separate from `.env`, copy the same keys into a gitignored `.dev.vars` file instead — see [Deploy](#deploy) for how those become production secrets.

### Slack (bug-report ingress)

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) in your workspace.
2. Copy the **Signing Secret** from *Basic Information* into `SLACK_SIGNING_SECRET` in `.env`.
3. Under *Event Subscriptions*, enable events and set the Request URL to `<base-url>/channels/slack/events` (for local dev, expose `http://localhost:5173` with a tunnel). The URL-verification handshake is answered automatically. **Make sure Socket Mode is off** (*Socket Mode* page in the app settings) — with it on, Slack routes events to a WebSocket instead of the Request URL and nothing ever arrives, silently.
4. Subscribe to the **`message.channels`** bot event, which requires the **`channels:history`** bot scope, then install the app to the workspace. If the bug-report channel is **private**, subscribe to **`message.groups`** (scope `groups:history`) instead — and note that after changing events or scopes you must save and **reinstall** the app before Slack delivers anything.
5. Invite the app to your bug-report channel (`/invite @your-app`) and put that channel's ID (e.g. `C0123456789`, shown in the channel's details pane) in `SLACK_BUG_CHANNEL_ID`.

### GitHub (issue filing)

1. Create a token with **issue-write access** to the target repository — a [fine-grained personal access token](https://github.com/settings/personal-access-tokens) with *Issues: Read and write* on that repo, or a classic token with `repo` scope.
2. Set `GITHUB_TOKEN` to the token and `GITHUB_REPO` to the repository as `owner/repo` in `.env`.

Point `GITHUB_REPO` at a sandbox repository first to try the flow end to end before switching to the real tracker.

## Talk to your agent

```sh
npx flue run src/agents/hello.ts --message "Say hello!"
```

Conversations are durable — pass `--id <id>` to continue one.

## Develop

```sh
npm run dev
```

The Hello agent is served at `http://localhost:5173/agents/hello` — see `src/app.ts` for the route map and an example request.

## Deploy

This app runs on Cloudflare Workers — each agent (`Hello`, `BugTriage`) is generated as its own Durable Object class (see [`wrangler.jsonc`](./wrangler.jsonc)). Persistence is Durable Object SQLite, not a local file, so there's no database to provision.

### One-time setup

1. Set the deployed Worker's secrets (these are separate from your local `.env`/`.dev.vars`, and persist across deploys — you only need to do this once, or whenever a value changes):
   ```sh
   npx wrangler secret put OPENROUTER_API_KEY
   npx wrangler secret put SLACK_SIGNING_SECRET
   npx wrangler secret put SLACK_BUG_CHANNEL_ID
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put GITHUB_REPO
   ```
2. Point Slack's Events API Request URL at the deployed Worker (`https://<worker-name>.<your-subdomain>.workers.dev/channels/slack/events`) instead of a local tunnel.

### Manual deploy

```sh
npm run deploy   # vite build && wrangler deploy
```

### Continuous deploy (GitHub Actions)

[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) builds and deploys automatically on every push to `main` — in practice, every merged PR. It needs two repository secrets (**Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_API_TOKEN` — a token scoped with the "Edit Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID (`wrangler whoami` shows it)

These authorize the *deploy*; they're unrelated to the app secrets set with `wrangler secret put` above, which only need to be set once on the Worker itself.

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
