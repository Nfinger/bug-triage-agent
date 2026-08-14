import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { client } from '../channels/github-client.ts';
import { reviewLabel, reviewRepo, trackerRepo } from '../review/config.ts';

// Read-only inspection of the repository under review. Only read endpoints are
// exposed here: the architecture review looks at code and at its own past
// reports, and can change neither.

const MAX_TREE_ENTRIES = 400;
const MAX_FILE_LINES = 2_000;
const MAX_FILE_BYTES = 64 * 1024;

// Defence in depth: secrets should never be committed, but a review agent has
// no reason to read one back out if they were.
const SECRET_PATHS = [/(^|\/)\.env(\..+)?$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /(^|\/)id_(rsa|dsa|ecdsa|ed25519)/i];

type ToolError = { ok: false; error: string };

// Annotated where a tool has more than one success/failure exit, so the union
// stays a plain JSON shape instead of widening into optional-undefined members.
type ReadFileOutput = ToolError | { ok: true; path: string; lines: number; truncated: boolean; content: string };

function errorOutput(error: unknown): ToolError {
	return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function listRepoFiles() {
	return defineTool({
		name: 'list_repo_files',
		description:
			'List the files in the repository under review, optionally filtered to a path prefix. ' +
			'Call this once to orient yourself, then read only the files relevant to your focus area.',
		input: v.object({
			pathPrefix: v.optional(v.string()),
		}),
		async run({ data }) {
			try {
				const { owner, repo } = reviewRepo();
				const repository = await client.rest.repos.get({ owner, repo });
				const tree = await client.rest.git.getTree({
					owner,
					repo,
					tree_sha: repository.data.default_branch,
					recursive: 'true',
				});
				const prefix = data.pathPrefix?.replace(/^\/+/, '') ?? '';
				const matches = tree.data.tree
					.filter((entry) => entry.type === 'blob' && entry.path)
					.filter((entry) => entry.path!.startsWith(prefix))
					.map((entry) => ({ path: entry.path!, size: entry.size ?? 0 }));
				return {
					output: {
						ok: true,
						repository: `${owner}/${repo}`,
						ref: repository.data.default_branch,
						files: matches.slice(0, MAX_TREE_ENTRIES),
						truncated: Boolean(tree.data.truncated) || matches.length > MAX_TREE_ENTRIES,
					},
				};
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}

export function readRepoFile() {
	return defineTool({
		name: 'read_repo_file',
		description:
			'Read one file from the repository under review. Contents come back with 1-based line ' +
			'numbers so findings can cite path:line. Large files are truncated.',
		input: v.object({
			path: v.pipe(v.string(), v.minLength(1)),
		}),
		async run({ data }): Promise<{ output: ReadFileOutput }> {
			try {
				const path = data.path.replace(/^\/+/, '');
				if (SECRET_PATHS.some((pattern) => pattern.test(path))) {
					return {
						output: { ok: false, error: `Refusing to read "${path}": secret-shaped path` },
					};
				}
				const { owner, repo } = reviewRepo();
				const response = await client.rest.repos.getContent({ owner, repo, path });
				if (Array.isArray(response.data) || response.data.type !== 'file') {
					return { output: { ok: false, error: `"${path}" is not a file` } };
				}
				if (!response.data.content) {
					return {
						output: { ok: false, error: `"${path}" is too large to read through the contents API` },
					};
				}
				const decoded = Buffer.from(response.data.content, 'base64').toString('utf8');
				const clipped = decoded.slice(0, MAX_FILE_BYTES);
				const lines = clipped.split('\n');
				const kept = lines.slice(0, MAX_FILE_LINES);
				return {
					output: {
						ok: true,
						path,
						lines: kept.length,
						truncated: clipped.length < decoded.length || kept.length < lines.length,
						content: kept.map((line, index) => `${index + 1}\t${line}`).join('\n'),
					},
				};
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}

export function listRecentArchitectureReports() {
	return defineTool({
		name: 'list_recent_architecture_reports',
		description:
			'List recent architecture-review issues filed by earlier runs, newest first. ' +
			'Read these before reporting so an already-reported finding is referenced, not restated.',
		input: v.object({
			limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))),
		}),
		async run({ data }) {
			try {
				const { owner, repo } = trackerRepo();
				const response = await client.rest.issues.listForRepo({
					owner,
					repo,
					labels: reviewLabel(),
					state: 'all',
					sort: 'created',
					direction: 'desc',
					per_page: data.limit ?? 5,
				});
				return {
					output: {
						ok: true,
						reports: response.data.map((issue) => ({
							number: issue.number,
							title: issue.title,
							state: issue.state,
							url: issue.html_url,
							excerpt: (issue.body ?? '').slice(0, 600),
						})),
					},
				};
			} catch (error) {
				return { output: errorOutput(error) };
			}
		},
	});
}
