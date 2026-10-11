# Active plan: Wikipedia descriptions for OSM-only places

Branch: `feat/wiki-descriptions`

**Ship rule:** A waypoint whose description came from the OSM listing, or
that has none, gets the first sentence of its Wikipedia article when one is
found. The article must match the place's exact name, directly or by
redirect ("Wyoming Frontier Prison" → "Wyoming State Penitentiary"). It must
not be a disambiguation page, its coordinates must be within 10 km of the
town, and the sentence must be 240 characters or fewer, since Roadtripper
never cuts one. A description from any other source is never replaced. In
the ten OSM towns this describes 7–9 sights, among them Rawlins' and Grand
Island's picks.

**What changes**
- `osm_ground.py` marks the descriptions it writes or removes:
  `description_source: "osm"`. Ingest copies named fields only, so the mark
  stays in the JSON.
- `wiki_describe.py`: pure selection and matching, with the fetch injected,
  and unit tests.
- Phase C runs it after OSM grounding. A new `--describe-only` re-grounds a
  saved JSON offline and adds Wikipedia lines without a Gemini call, so the
  waypoint IDs stay stable and a re-ingest leaves no orphans.

**Cost:** One or two Wikipedia API calls per town, for titles in batches of 20.
No Gemini calls.

**Weakest part:** a redirect can point at a broader article. "Wyoming Frontier
Prison" lands on "Wyoming State Penitentiary", whose first sentence covers
the old and the current prison. The 10 km check keeps it local, but not
specific.
