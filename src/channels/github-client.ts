import { Octokit } from '@octokit/rest';

// Outbound GitHub access for filing issues and opening PRs. Kept separate
// from the webhook channel so tools can import the client without pulling
// in the agent graph (and its cloudflare:workers imports).
export const client = new Octokit({
	auth: process.env.GITHUB_TOKEN,
});
