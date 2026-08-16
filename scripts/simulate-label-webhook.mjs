// Simulate GitHub's `issues.labeled` webhook delivery for a real issue in the
// configured repository, signed with GITHUB_WEBHOOK_SECRET, against a locally
// running dev server. Equivalent to applying the opt-in label with a tunnel in
// place — everything downstream (sandbox, fix, push, PR) runs for real.
//
// Usage: node --env-file=.dev.vars scripts/simulate-label-webhook.mjs <issue-number> [port]
import crypto from 'node:crypto';

const issueNumber = Number(process.argv[2]);
const port = Number(process.argv[3] ?? 5173);
if (!Number.isInteger(issueNumber) || issueNumber < 1) {
	console.error('Usage: node --env-file=.dev.vars scripts/simulate-label-webhook.mjs <issue-number> [port]');
	process.exit(1);
}

const secret = process.env.GITHUB_WEBHOOK_SECRET;
const token = process.env.GITHUB_TOKEN;
const label = process.env.CODING_AGENT_LABEL || 'agent-fix';
const [owner, repo] = (process.env.GITHUB_REPO ?? '').split('/');
if (!secret || !token || !owner || !repo) {
	console.error('GITHUB_WEBHOOK_SECRET, GITHUB_TOKEN, and GITHUB_REPO must be set');
	process.exit(1);
}

// Pull the real issue so the payload matches what GitHub would deliver.
const issueRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
	headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
});
if (!issueRes.ok) {
	console.error(`Failed to fetch issue #${issueNumber}: HTTP ${issueRes.status}`);
	process.exit(1);
}
const issue = await issueRes.json();

const body = JSON.stringify({
	action: 'labeled',
	label: { name: label },
	issue: {
		number: issue.number,
		title: issue.title,
		body: issue.body,
		html_url: issue.html_url,
	},
	repository: { name: repo, full_name: `${owner}/${repo}`, owner: { login: owner } },
	sender: { login: 'simulate-label-webhook' },
});

const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
const res = await fetch(`http://localhost:${port}/channels/github/webhook`, {
	method: 'POST',
	headers: {
		'content-type': 'application/json',
		'x-github-event': 'issues',
		'x-github-delivery': `simulated-${issueNumber}-${Date.now()}`,
		'x-hub-signature-256': sig,
	},
	body,
});
console.log(`Delivered "${label}" label event for #${issueNumber} ("${issue.title}"): HTTP ${res.status}`);
