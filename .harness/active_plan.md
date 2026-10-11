# Active plan: OpenStreetMap as a source for thin towns

Branch: `feat/osm-source`

**Ship rule:** Grand Island, Rock Springs, Rawlins, Snyder, Santa Rosa,
Brownwood, Colby, Ogallala, Elk City and West Wendover failed Phase C (<6
waypoints) because Wikipedia and Atlas Obscura say almost nothing about them.
After this change, at least 7 of the 10 pass Phase C and ingest. Every ingested
waypoint is within the Phase C distance of its town, and none is invented: each
name appears in a source.

**What changes**
- `src/scrapers/osm.ts` asks Overpass for named places within the town's
  `maxRadiusKm`: museums, attractions, viewpoints, galleries, artwork, historic
  sites, parks with a wikidata link, restaurants, cafés, bars, theatres and arts
  centres. It writes `data/osm/<id>.md`, one line per place with its kind,
  address and coordinates. Places sort by kind (sights before food), capped at
  80 lines.
- `TEXT_SOURCE_DIRS` gains `("osm", "OpenStreetMap")`, so Phase A grounds on it
  like any other source, inside the same untrusted-data tags.
- Pure helpers are unit tested: tags to kind, the sort and cap, markdown, and
  dropping unnamed places and places without coordinates.

**Cost:** One Overpass call per town, which is free with a 5 s pause. Re-running
research costs 3–4 Gemini calls per town, about 40 for the ten.

**Weakest part:** OSM tells Gemini that a place exists, not why it is worth a
stop. Gemini may write thin or generic descriptions from a bare list. The
mitigation is a manual read of Grand Island's report before running the rest.
Also, Wendover's places straddle the Utah–Nevada line, and the town's centre
must be the right one.
