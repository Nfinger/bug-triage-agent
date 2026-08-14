/**
 * Configuration for the weekly architecture review. When the review fires is
 * not configured here: on the Cloudflare target the cadence lives in
 * wrangler.jsonc ("triggers.crons"), which Cloudflare evaluates in UTC.
 * Everything unusable throws rather than writing to the wrong repository.
 */

const DEFAULT_LABEL = 'architecture-review';

function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

/** Scheduled runs are skipped entirely when this is turned off. */
export function reviewEnabled(): boolean {
	const raw = env('ARCH_REVIEW_ENABLED');
	if (raw === undefined) return true;
	const value = raw.toLowerCase();
	if (['false', '0', 'no', 'off'].includes(value)) return false;
	if (['true', '1', 'yes', 'on'].includes(value)) return true;
	throw new Error(`ARCH_REVIEW_ENABLED must be a boolean ("true" or "false"), got "${raw}"`);
}

/** Label applied to filed reports, and the filter used to find past ones. */
export function reviewLabel(): string {
	return env('ARCH_REVIEW_LABEL') ?? DEFAULT_LABEL;
}

// Repositories are fixed by configuration — the model never chooses what is
// read or written. Accepts "owner/repo" or a github.com URL, like
// `targetRepo()` in ../tools/github-issues.ts.
function parseRepo(value: string | undefined, variable: string): { owner: string; repo: string } {
	const configured = (value ?? '')
		.replace(/^https?:\/\/(www\.)?github\.com\//, '')
		.replace(/\.git$/, '')
		.replace(/\/+$/, '');
	const [owner, repo, ...rest] = configured.split('/');
	if (!owner || !repo || rest.length > 0) {
		throw new Error(`${variable} must be set to "owner/repo" or a github.com repository URL`);
	}
	return { owner, repo };
}

/** Repository that receives the filed report issues. */
export function trackerRepo(): { owner: string; repo: string } {
	return parseRepo(env('GITHUB_REPO'), 'GITHUB_REPO');
}

/** Repository whose code is reviewed; defaults to the tracker repository. */
export function reviewRepo(): { owner: string; repo: string } {
	const configured = env('ARCH_REVIEW_REPO');
	return configured ? parseRepo(configured, 'ARCH_REVIEW_REPO') : trackerRepo();
}
