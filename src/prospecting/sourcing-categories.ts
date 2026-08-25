/**
 * The sourcing run's category rotation. Selection of the day's focus happens
 * here, in code, so coverage across the ICP is a property of the schedule —
 * the model researches what it's assigned, it doesn't pick a favorite niche.
 * The list mirrors the ICP prose in docs/business/icp.md.
 */

export interface SourcingCategory {
	key: string;
	/** What to look for, phrased for the research prompt. */
	description: string;
	/** HubSpot industry picklist values a find in this category may use. */
	industries: string[];
}

export const SOURCING_CATEGORIES: SourcingCategory[] = [
	{
		key: 'wedding-event-venues',
		description: 'wedding and event venues (barns, estates, banquet halls, function rooms, event farms) and the event planners and coordinators who book them',
		industries: ['EVENTS_SERVICES', 'HOSPITALITY', 'ENTERTAINMENT'],
	},
	{
		key: 'campgrounds-resorts',
		description: 'campgrounds, resorts, lodges, and inns with group amenities (pavilions, lawns, activity programs)',
		industries: ['HOSPITALITY', 'LEISURE_TRAVEL_TOURISM', 'RECREATIONAL_FACILITIES_AND_SERVICES'],
	},
	{
		key: 'breweries-restaurants',
		description: 'breweries, taprooms, wineries, and restaurants with patios, lawns, or event space',
		industries: ['FOOD_BEVERAGES', 'WINE_AND_SPIRITS', 'RESTAURANTS'],
	},
	{
		key: 'corporate-hr',
		description: 'employers with 25+ staff whose HR or office teams run company picnics, retreats, and team events',
		industries: ['HUMAN_RESOURCES'],
	},
	{
		key: 'community-civic',
		description: 'community organizations, chambers of commerce, granges, and civic groups that host fairs and public events',
		industries: ['CIVIC_SOCIAL_ORGANIZATION'],
	},
	{
		key: 'recreation-activity',
		description: 'golf courses, recreation centers, activity venues, and camps that host groups and outings',
		industries: ['RECREATIONAL_FACILITIES_AND_SERVICES', 'ENTERTAINMENT', 'LEISURE_TRAVEL_TOURISM'],
	},
];

/** Every industry value a sourced company may carry, across all categories. */
export const SOURCING_INDUSTRIES = [...new Set(SOURCING_CATEGORIES.flatMap((category) => category.industries))];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic rotation: same run date → same focus; consecutive days differ. */
export function focusCategoryFor(runDate: string): SourcingCategory {
	const epochDay = Math.floor(Date.parse(`${runDate}T00:00:00Z`) / DAY_MS);
	return SOURCING_CATEGORIES[((epochDay % SOURCING_CATEGORIES.length) + SOURCING_CATEGORIES.length) % SOURCING_CATEGORIES.length];
}
