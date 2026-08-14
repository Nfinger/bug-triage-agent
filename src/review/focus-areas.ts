/**
 * The rotation the weekly review walks. Which area a run covers is computed
 * from the week of the fire, not chosen by the model: coverage becomes a
 * property of this file, and "what does next week cover?" is answerable
 * without running anything.
 */

export interface FocusArea {
	id: string;
	title: string;
	/** What is in scope, named concretely enough that the agent knows where to look. */
	brief: string;
}

export const FOCUS_AREAS: FocusArea[] = [
	{
		id: 'ingress-security',
		title: 'Ingress & channel security',
		brief:
			'Inbound HTTP surface: signature verification, request filtering, what reaches an agent and what is dropped, ' +
			'acknowledgment timing, and replay handling. Start at src/channels/ and the routes mounted in src/app.ts.',
	},
	{
		id: 'agent-design',
		title: 'Agent design & prompts',
		brief:
			'Agent modules in src/agents/: conversation identity, prompt clarity and failure instructions, initial-data ' +
			'schemas, model choice, and whether an agent can be driven into a state its prompt does not cover.',
	},
	{
		id: 'outbound-tools',
		title: 'Outbound tools & external calls',
		brief:
			'Tools in src/tools/: input validation, what the model is allowed to choose versus what configuration fixes, ' +
			'error propagation, retries and idempotency of external side effects, and rate-limit exposure.',
	},
	{
		id: 'persistence',
		title: 'Persistence & durability',
		brief:
			'src/db.ts and the durability assumptions around it: what survives a restart, conversation and attachment ' +
			'growth over time, backup and retention, and what breaks if the app runs as more than one instance.',
	},
	{
		id: 'configuration-secrets',
		title: 'Configuration & secrets',
		brief:
			'Environment variables across the app: missing validation, unsafe defaults, secrets that could be logged or ' +
			'read back out, drift between .env.example and what the code reads, and least-privilege of external tokens.',
	},
	{
		id: 'dependencies-build',
		title: 'Dependencies & build',
		brief:
			'package.json, the build and typecheck setup, and vite/tsconfig configuration: pinning and update posture, ' +
			'unused or duplicated dependencies, type-safety escape hatches, and what the built artifact actually contains.',
	},
	{
		id: 'observability',
		title: 'Observability & operability',
		brief:
			'What an operator can see when something fails: logging around dispatch and tool failures, silent catches, ' +
			'health signals, and whether a dropped report or a failed run is discoverable without reading the database.',
	},
	{
		id: 'scheduled-work',
		title: 'Scheduled & background work',
		brief:
			'src/schedules/ and anything that runs without a request: missed and overlapping fires, duplicate work across ' +
			'replicas, idempotency of scheduled side effects, and cost or context growth per run.',
	},
];

function zonedParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
	// en-CA formats as YYYY-MM-DD, which is exactly the shape needed.
	const formatted = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date);
	const [year, month, day] = formatted.split('-').map(Number);
	return { year, month, day };
}

/** The fire's calendar date in the configured timezone, as `YYYY-MM-DD`. */
export function runDateIn(date: Date, timeZone: string): string {
	const { year, month, day } = zonedParts(date, timeZone);
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Count of whole ISO weeks (Monday-based) since Monday 1970-01-05, evaluated in
 * the given timezone. A continuous count rather than the 1–53 ISO week *number*:
 * the number resets each January and would skip a slot in the rotation once a
 * year, while this walks the catalogue in order forever.
 */
export function weekIndex(date: Date, timeZone: string): number {
	const { year, month, day } = zonedParts(date, timeZone);
	const days = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
	const EPOCH_MONDAY = 4; // 1970-01-05, the first Monday of the epoch.
	return Math.floor((days - EPOCH_MONDAY) / 7);
}

/** The focus area a run fired at `date` covers. Pure and deterministic. */
export function selectFocusArea(date: Date, timeZone: string): FocusArea {
	return FOCUS_AREAS[weekIndex(date, timeZone) % FOCUS_AREAS.length];
}
