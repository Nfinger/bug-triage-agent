/**
 * Configuration for the daily prospecting run. When it fires lives in
 * wrangler.jsonc ("triggers.crons", evaluated by Cloudflare in UTC), not here.
 * Everything unusable throws rather than contacting the wrong people — the
 * one exception is `outreachTemplateId()`, which is only required once real
 * sending is switched on.
 */

function env(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function flag(name: string, fallback: boolean): boolean {
	const raw = env(name);
	if (raw === undefined) return fallback;
	const value = raw.toLowerCase();
	if (['false', '0', 'no', 'off'].includes(value)) return false;
	if (['true', '1', 'yes', 'on'].includes(value)) return true;
	throw new Error(`${name} must be a boolean ("true" or "false"), got "${raw}"`);
}

function integer(name: string, fallback: number, { min, max }: { min: number; max: number }): number {
	const raw = env(name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
	}
	return value;
}

function required(name: string, hint: string): string {
	const value = env(name);
	if (!value) throw new Error(`${name} must be set (${hint})`);
	return value;
}

/** Scheduled runs are skipped entirely when this is turned off. */
export function prospectingEnabled(): boolean {
	return flag('PROSPECTING_ENABLED', true);
}

/**
 * Whether composed emails are actually sent. Off by default: the run then
 * records every message as a draft note on the contact instead, so the whole
 * pipeline can be observed in the CRM before any email leaves.
 */
export function outreachEnabled(): boolean {
	return flag('OUTREACH_ENABLED', false);
}

/** Companies selected per run. */
export function batchSize(): number {
	return integer('PROSPECTING_BATCH_SIZE', 5, { min: 1, max: 50 });
}

/** Emails actually sent per run; further sends become drafts. */
export function dailyCap(): number {
	return integer('OUTREACH_DAILY_CAP', 5, { min: 0, max: 200 });
}

/** Days before a company or contact may be prospected / emailed again. */
export function cooldownDays(): number {
	return integer('OUTREACH_COOLDOWN_DAYS', 30, { min: 1, max: 365 });
}

/** Contacts emailed per selected company. */
export function contactsPerCompany(): number {
	return integer('OUTREACH_CONTACTS_PER_COMPANY', 1, { min: 1, max: 5 });
}

/** Days of CRM activity that count as a buying signal. */
export function signalLookbackDays(): number {
	return integer('PROSPECTING_LOOKBACK_DAYS', 30, { min: 1, max: 365 });
}

/** HubSpot private-app token; fixes the portal every tool operates on. */
export function hubspotToken(): string {
	return required('HUBSPOT_ACCESS_TOKEN', 'HubSpot private-app access token');
}

/** Address the outreach is sent from; must be a verified HubSpot sender. */
export function senderEmail(): string {
	const value = required('HUBSPOT_SENDER_EMAIL', 'verified HubSpot sending address');
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
		throw new Error(`HUBSPOT_SENDER_EMAIL must be an email address, got "${value}"`);
	}
	return value;
}

/**
 * Transactional email template that carries the branding and unsubscribe
 * footer; HubSpot's single-send API requires one. Only needed once sending
 * is on — draft mode never touches it.
 */
export function outreachTemplateId(): number {
	const raw = required('HUBSPOT_OUTREACH_TEMPLATE_ID', 'HubSpot transactional email template id');
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`HUBSPOT_OUTREACH_TEMPLATE_ID must be a positive integer, got "${raw}"`);
	}
	return value;
}

/** Slack channel that receives the end-of-run summary. */
export function slackProspectingChannel(): string {
	return required('SLACK_PROSPECTING_CHANNEL_ID', 'Slack channel id for run summaries');
}

/** Bot token used to post the summary (needs chat:write). */
export function slackBotToken(): string {
	return required('SLACK_BOT_TOKEN', 'Slack bot token with chat:write');
}

/** Search-provider key for the web_search research tool. */
export function webSearchApiKey(): string {
	return required('WEB_SEARCH_API_KEY', 'Brave Search API key');
}

/**
 * Bearer token for the operator-only manual-run endpoint. Unset (the
 * default) means the endpoint does not exist: it responds 404.
 */
export function manualRunToken(): string | undefined {
	return env('PROSPECTING_MANUAL_TOKEN');
}

/** Hunter.io key for email lookups; unset means the lookup tool is not offered. */
export function hunterApiKey(): string | undefined {
	return env('HUNTER_API_KEY');
}

/** Minimum Hunter confidence/score for an address to count as verified. */
export function hunterMinScore(): number {
	return integer('HUNTER_MIN_SCORE', 80, { min: 50, max: 100 });
}

/** Hunter lookups allowed per company per run (each call costs credits). */
export function hunterLookupsPerCompany(): number {
	return integer('HUNTER_LOOKUPS_PER_COMPANY', 2, { min: 0, max: 10 });
}

/** Scheduled sourcing runs are skipped entirely when this is turned off. */
export function sourcingEnabled(): boolean {
	return flag('SOURCING_ENABLED', true);
}

/** Companies the sourcing run may create per run. */
export function sourcingMaxCompanies(): number {
	return integer('SOURCING_MAX_COMPANIES', 5, { min: 1, max: 25 });
}

/**
 * Validate everything a run needs before any CRM read or write. Called by the
 * dispatcher so a misconfigured deploy fails at the fire, not mid-run.
 */
export function assertProspectingConfig(): void {
	hubspotToken();
	senderEmail();
	slackProspectingChannel();
	slackBotToken();
	webSearchApiKey();
	batchSize();
	dailyCap();
	cooldownDays();
	contactsPerCompany();
	signalLookbackDays();
	if (outreachEnabled()) outreachTemplateId();
}
