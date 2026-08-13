import { Octokit } from '@octokit/rest';

// Outbound-only GitHub access for filing issues. The @flue/github inbound
// webhook channel is intentionally not created or mounted — nothing in this
// app reacts to GitHub events.
export const client = new Octokit({
	auth: process.env.GITHUB_TOKEN,
});
