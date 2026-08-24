import * as v from 'valibot';

/**
 * Business knowledge: the versioned markdown under docs/business/, which tells
 * the agent who we are, what we sell, who we sell to, and how we talk. Two of
 * the files carry a fenced `json` block that the code itself consumes — the
 * ICP for scoring and persona matching, the messaging limits for the send
 * tool's linter. Parsing is pure so it can be tested without the bundle;
 * business-docs.ts does the build-time import.
 */

export const REQUIRED_DOCS = ['company.md', 'products.md', 'icp.md', 'messaging.md'] as const;
export type DocName = (typeof REQUIRED_DOCS)[number];

// The prose goes into every prompt, so keep the whole set bounded.
export const MAX_TOTAL_BYTES = 40 * 1024;

const sizeRangeSchema = v.pipe(
	v.object({
		min: v.pipe(v.number(), v.integer(), v.minValue(0)),
		max: v.pipe(v.number(), v.integer(), v.minValue(1)),
	}),
	v.check((range) => range.max >= range.min, 'sizeRange max must be >= min'),
);

const icpSchema = v.object({
	industries: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1)),
	sizeRanges: v.pipe(v.array(sizeRangeSchema), v.minLength(1)),
	geographies: v.array(v.pipe(v.string(), v.minLength(1))),
	personaTitlePatterns: v.pipe(
		v.array(
			v.pipe(
				v.string(),
				v.minLength(1),
				v.check((pattern) => {
					try {
						new RegExp(pattern, 'i');
						return true;
					} catch {
						return false;
					}
				}, 'personaTitlePatterns entries must be valid regular expressions'),
			),
		),
		v.minLength(1),
	),
	excludedDomains: v.array(v.pipe(v.string(), v.minLength(1))),
});

const messagingSchema = v.object({
	maxWords: v.pipe(v.number(), v.integer(), v.minValue(20), v.maxValue(500)),
	maxSubjectWords: v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(20)),
	bannedPhrases: v.array(v.pipe(v.string(), v.minLength(1))),
});

export type Icp = v.InferOutput<typeof icpSchema>;
export type MessagingRules = v.InferOutput<typeof messagingSchema>;

export interface Knowledge {
	/** Every doc's markdown, in REQUIRED_DOCS order, for the prompt. */
	prose: string;
	icp: Icp;
	messaging: MessagingRules;
}

export type DocSources = Record<DocName, string>;

function fencedJsonBlock(markdown: string, file: string): unknown {
	const match = /```json\s*\n([\s\S]*?)\n```/.exec(markdown);
	if (!match) throw new Error(`docs/business/${file} is missing its fenced \`\`\`json block`);
	try {
		return JSON.parse(match[1]!);
	} catch (error) {
		throw new Error(
			`docs/business/${file} json block is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function parseBlock<TSchema extends v.GenericSchema>(
	schema: TSchema,
	markdown: string,
	file: string,
): v.InferOutput<TSchema> {
	const result = v.safeParse(schema, fencedJsonBlock(markdown, file));
	if (!result.success) {
		const issues = result.issues.map((issue) => `${v.getDotPath(issue) ?? '?'}: ${issue.message}`);
		throw new Error(`docs/business/${file} json block failed validation: ${issues.join('; ')}`);
	}
	return result.output;
}

/** Validate and assemble the business knowledge from raw doc contents. */
export function parseKnowledge(sources: DocSources): Knowledge {
	for (const name of REQUIRED_DOCS) {
		if (!sources[name] || sources[name].trim().length === 0) {
			throw new Error(`docs/business/${name} is missing or empty; the prospecting agent cannot run without it`);
		}
	}
	const total = REQUIRED_DOCS.reduce((sum, name) => sum + Buffer.byteLength(sources[name], 'utf8'), 0);
	if (total > MAX_TOTAL_BYTES) {
		throw new Error(
			`docs/business/ totals ${total} bytes, over the ${MAX_TOTAL_BYTES}-byte cap; trim the docs rather than relying on truncation`,
		);
	}
	return {
		prose: REQUIRED_DOCS.map((name) => `<!-- docs/business/${name} -->\n${sources[name].trim()}`).join('\n\n'),
		icp: parseBlock(icpSchema, sources['icp.md'], 'icp.md'),
		messaging: parseBlock(messagingSchema, sources['messaging.md'], 'messaging.md'),
	};
}

/** Compiled persona matchers, in the order listed (earlier = preferred). */
export function personaMatchers(icp: Icp): RegExp[] {
	return icp.personaTitlePatterns.map((pattern) => new RegExp(pattern, 'i'));
}
