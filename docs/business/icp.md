# Ideal customer profile — Maine expansion

<!-- The fenced `json` block is machine-read: it drives account scoring
     (industries, size, geographies) and contact selection (persona title
     patterns, excluded domains). `geographies` entries may be US states
     (name or two-letter code) or countries. -->

```json
{
  "industries": [
    "HOSPITALITY",
    "FOOD_BEVERAGES",
    "EVENTS_SERVICES",
    "ENTERTAINMENT",
    "RESTAURANTS",
    "RECREATIONAL_FACILITIES_AND_SERVICES",
    "WINE_AND_SPIRITS",
    "CIVIC_SOCIAL_ORGANIZATION",
    "HUMAN_RESOURCES",
    "LEISURE_TRAVEL_TOURISM"
  ],
  "sizeRanges": [{ "min": 1, "max": 1000 }],
  "geographies": ["Maine"],
  "personaTitlePatterns": [
    "\\b(event|events|experience)s? (manager|coordinator|director|planner)\\b",
    "\\b(taproom|tasting room|venue|banquet|catering) manager\\b",
    "\\b(owner|founder|proprietor|general manager|gm)\\b",
    "\\b(hr|human resources|people) (manager|director|generalist|partner|lead)\\b",
    "\\boffice (manager|administrator)\\b",
    "\\b(marketing|community) (manager|director|coordinator)\\b",
    "\\bactivities? (director|coordinator)\\b"
  ],
  "excludedDomains": ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "comcast.net"]
}
```

## Who buys

People in **Maine** who are responsible for other people having a good time, repeatedly: brewery and taproom managers filling a patio on weeknights, wedding and event venue coordinators differentiating their package, HR and office managers who own the company picnic and dread the logistics, campground and resort activities directors, community-event organizers. The recurring thread: they host groups, they compete for attendance or bookings, and setup labor is their scarcest resource.

## Who does not

Businesses outside Maine (Boston-area sales are handled by the existing locations, not this outreach). Private individuals planning one party — we serve them happily inbound, but we don't cold-email consumers. Equipment resellers. Existing customers, excluded automatically.

## Signals that matter

A form fill or site visit means they're already pricing an event — reference it. An open deal means a conversation exists: the email supports it, never restarts it. For breweries and venues, seasonality is real — spring outreach lands before summer calendars fill.
