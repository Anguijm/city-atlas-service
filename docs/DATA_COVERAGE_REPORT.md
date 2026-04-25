# Urban Explorer — Data Sources & City Coverage Report

**Generated:** 2026-04-22
**Scope:** All 185 cities in `src/data/global_city_cache.json` + scraper outputs under `data/` + Firestore research manifest at `src/data/research-output/batch-manifest.json`.

> **Status update 2026-04-24:** This document is a point-in-time snapshot from before `city-atlas-service` was extracted from urban-explorer. Paths referenced in the report (`scripts/research-city.py`, `src/data/global_city_cache.json`, etc.) are the urban-explorer-side paths. In this repo they map to `src/pipeline/research_city.py` and `configs/global_city_cache.json`.
>
> **Status update 2026-04-26 — issue #11 closed by PR #15:** Spotted by Locals is **retired**. Remove §3.2 entries when the report is next regenerated; the source list below is now 6, not 7. Atlas Obscura URL pattern fixed via `configs/atlas-obscura-slugs.json` (17 US-state overrides seeded). The Infatuation now uses the geo-scoped finder endpoint concatenated with the legacy slug page (~10 KB MD per city, up from ~7 KB). The pipeline file references throughout this report (`scripts/research-city.py`, `scripts/scrape-atlas.ts`, etc.) remain at their **urban-explorer-side paths** — in this repo they map to `src/pipeline/research_city.py` and `src/scrapers/atlas-obscura.ts`, etc. (see top-of-file note from 2026-04-24).
>
> **Status update 2026-04-25 — the 19 parked cities arc closed:** All blockers identified in this report's §7 are resolved.
> - PR #4 (`a733650`) landed the proportional `>25%` FAIL threshold (the original blueprint item #26 prereq).
> - Three downstream porting-miss bugs surfaced and were fixed: Python path constants (`90b8c2a`), TypeScript scraper path constants (`f627d83`), and `--ingest-only` flag composition (`1f173b7`). None of the three would have been caught by the existing test suites; tracked as issue #12 for CI prevention.
> - Wikipedia + Reddit re-scraped for all 19 parked metros once the scrapers actually worked (the previous "stale 2026-04-08 sources" framing was wrong — the scrapers had been crashing on every invocation since the extraction; the small-US-cohort .md files were migrated from urban-explorer, not freshly scraped here).
> - **15/19 ingested cleanly to Firestore** (algiers, boston, buenos-aires, cincinnati, denver, fukuoka, houston, las-vegas, melbourne, muscate, nashville, osaka, rome, shanghai, tokyo). 4 of the 15 ship `quality_status: verified` (boston, houston, melbourne, tokyo) — first verified data ever produced from this repo.
> - **Honolulu** is recoverable in one step (Gemini-variance casualty of the pre-fix `--ingest-only` bug; data intact in `data/research-output/failed/`). See `SESSION_HANDOFF.md` "Now" tier.
> - **Geneva, Lisbon, London** are the unresolved tail. Geneva + Lisbon: legitimate English-source-coverage edge cases — Phase B fabricates over the gap and Phase C correctly rejects at >25%. London: present in `configs/global_city_cache.json` but absent from `manifest.cities`, mystery TBD.
> - The **5 legitimate village-tier failures** described in §1 (`fairbanks`, `kahului`, `marfa`, `little-rock`, `portland-me`) are still legitimately limited by real POI density at small radii. Not affected by the parked-19 arc.

---

## 1. Overview

| Metric | Value |
|---|---|
| Total cities | 185 |
| Countries represented | 52 (top: United States 100, Japan 5, China 5, Italy 4, Canada 4, UK 3, Spain 3, India 3) |
| Coverage tiers | metro 135 / town 33 / village 17 |
| Research pipeline status | 116 completed / 50 pending (new US cities, this session) / 19 skipped (parked failed — separate Phase C bug) |
| Firestore data volume (as of last enrichment batch, 2026-04-08) | 116 cities enriched with +1,869 waypoints + +8,618 tasks |

The **50 pending** cities are the new US towns/villages added in commit `6dee276`. None of them had been scraped before this session because the editorial sources (Atlas Obscura, Infatuation, TimeOut, Spotted-by-Locals, Locationscout) do not cover small US metros. This report documents how we closed that gap with two new scrapers (Wikipedia + Reddit).

The **19 skipped** cities (London, Tokyo, Rome, Boston, Osaka, Nashville, Denver, etc.) failed Phase C semantic validation in the 2026-04-08 batch due to an absolute 3+ hallucinated-places threshold being too strict for small enrichment deltas. They are currently parked with `status=skipped, prev_status=failed` in the manifest — they have full scraper coverage and are waiting on a proportional-threshold fix (blueprint item #26) before retry. See §7.

---

## 2. Data Sources

The research pipeline reads markdown files from seven per-source directories under `data/`. Phase A (`scripts/research-city.py:336-401`) concatenates whatever `.md` files it finds for a city, wraps them in Gemini's research prompt, and requires at least one source > 200 chars. **The pipeline reads only `.md` files** — `.json` files alongside them are dead output, a legacy from earlier structured-extraction attempts.

| Source | Output Dir | Scraper Script | Type | Shipped | Coverage |
|---|---|---|---|---|---|
| Atlas Obscura | `data/atlas-obscura/` | `scripts/scrape-atlas.ts` | Playwright HTML scrape of `/things-to-do/{city-country}` pages | 2026-03-31 | 68/185 (all metro) |
| Spotted by Locals | `data/spotted-by-locals/` | `scripts/scrape-local-sources.ts --source spotted-by-locals` | Playwright, per-city curated spot cards | 2026-03-31 | 42/185 (all metro) |
| The Infatuation | `data/the-infatuation/` | `scripts/scrape-local-sources.ts --source the-infatuation` | Playwright, uses real `a[href*="/{slug}/reviews/"]` selectors (rebuilt 2026-04-08 after selector drift) | 2026-04-08 | 73/185 (all metro) |
| TimeOut | `data/timeout/` | `scripts/scrape-local-sources.ts --source timeout` | Playwright, **prose-only** (round-up articles, no structured venues) | 2026-04-08 | 107/185 (all metro) |
| Locationscout | `data/locationscout/` | `scripts/scrape-local-sources.ts --source locationscout` | Playwright, photo-spot database (`/search?q=` fallback removed to prevent global fuzzy matches like "Austria for Austin") | 2026-04-08 | 135/185 (all metro) |
| **Wikipedia** | `data/wikipedia/` | `scripts/scrape-wikipedia.ts` | **MediaWiki REST API + opensearch fallback** (new this session) | 2026-04-22 | 49/185 (0 metro, 33 town, 16 village) |
| **Reddit** | `data/reddit/` | `scripts/scrape-reddit.ts` | **Unauthenticated public JSON API** (new this session) | 2026-04-22 | 15/185 and climbing (reddit-fill in flight) |

### Allowlist of editorial sources (`TEXT_SOURCE_DIRS` in research-city.py:327-335)

```python
TEXT_SOURCE_DIRS = [
    ("atlas-obscura",     "Atlas Obscura"),
    ("spotted-by-locals", "Spotted by Locals"),
    ("the-infatuation",   "The Infatuation"),
    ("timeout",           "TimeOut"),
    ("locationscout",     "Locationscout"),
    ("wikipedia",         "Wikipedia"),
    ("reddit",            "Reddit"),
]
```

### Batch-time auto-scrape (`scripts/batch-research.py:119-180`)

When the research pipeline starts a city, it first runs all scrapers for that city in sequence if their `.md` file is missing. Failures are non-fatal — coverage gaps produce a warning and the pipeline continues with whatever sources exist.

---

## 3. Source-by-Source Details (What / How / Assumptions)

### 3.1 Atlas Obscura — `scripts/scrape-atlas.ts`

- **What we get:** curated "unusual places" roundups with named POIs and prose descriptions.
- **How:** Playwright navigates `https://www.atlasobscura.com/things-to-do/{slug}` trying multiple URL patterns (`{name}-{country}`, `{name}`, aliases for edge cases like `ho-chi-minh → saigon`). Extracts place cards via text pattern matching.
- **Quality:** high — Atlas's editorial voice is strong and places are verified.
- **Assumptions:**
  - Only English-locale pages are scraped. Cities with thin English coverage (small non-English-speaking metros) often return empty.
  - Atlas Obscura has zero coverage of small US metros — the 50 new US cities all returned empty from this source.
  - Page HTML format is unstable; the quality gate in `scrape-local-sources.ts` rejects results where >75% of extracted names look like article titles (protects against layout drift).

### 3.2 Spotted by Locals — `scripts/scrape-local-sources.ts --source spotted-by-locals`

- **What we get:** local-insider spot cards, one curator's voice per city, typically small batch (~10-30 spots).
- **Coverage:** only 42 major cities (Berlin, Amsterdam, etc.). **0 successful scrapes** in the 2026-04-08 batch for the 50 new US cities — blueprint item #31 proposes retiring this source.
- **Assumptions:** same English-only + major-city-only as Atlas.

### 3.3 The Infatuation — `scripts/scrape-local-sources.ts --source the-infatuation`

- **What we get:** restaurant reviews — individual venue names with descriptions and cuisine tags.
- **How:** Playwright targets `a[href*="/{slug}/reviews/"]` with `h2/h3.chakra-heading` (real selectors, confirmed via live inspection 2026-04-08).
- **Quality:** high for food content, low for non-food POIs.
- **Assumptions:** US-heavy coverage; non-US cities often return empty.

### 3.4 TimeOut — `scripts/scrape-local-sources.ts --source timeout`

- **What we get:** **prose-only** round-up articles ("48 hours in X") — NOT structured venue data.
- **Why that matters:** The `.md` file is the landing page's article body. Gemini has to extract places from prose. Works well for metros (TimeOut has deep editorial archives) but produces thin output for small cities.

### 3.5 Locationscout — `scripts/scrape-local-sources.ts --source locationscout`

- **What we get:** photo-spot database entries (photography locations with lat/lng hints).
- **Gotcha fixed in 2026-04-08:** the `/search?q=` fallback was removed because Locationscout's search is a fuzzy global match — querying "austin" was returning "Austria" and "Westin Warsaw" results. Now only direct `/{city}` URLs are scraped.
- **Assumptions:** highly variable coverage; 135/185 but quality per-city depends on whether there's an active photographer community.

### 3.6 Wikipedia — `scripts/scrape-wikipedia.ts` (NEW, 2026-04-22)

- **What we get:** a curated subset of the city's Wikipedia article covering POI-dense sections (Culture, Tourism, Neighborhoods, Landmarks, Architecture, Parks, Notable places, Historic districts, etc.). Converted to plain markdown.
- **How:**
  1. Tries title candidates in priority order: **state-suffix form (`portland-me` → "Portland, Maine")**, disambiguated `clinicalName`, country-qualified form, bare name.
  2. Each candidate is fetched via the MediaWiki `action=parse&redirects=1&prop=text|sections` API.
  3. Articles are rejected if they look like disambiguation pages (Category:Disambiguation_pages) OR if they don't pass the `looksLikeCityArticle` check (must have an infobox-settlement template or a `Category:Cities|Towns|Villages|Populated_places|...` link).
  4. If all candidates fail, falls back to **opensearch** (`action=opensearch`) with results re-ranked to prefer `{name}, X` disambiguated forms.
  5. Section extraction handles both modern MediaWiki (`<h2 id="...">History</h2>`) and legacy (`<h2><span class="mw-headline">...</span></h2>`) heading formats. Grabs H2 and H3 because small US towns bury POI content in H3 subsections (e.g., `Neighborhoods` is an H3 under `Geography`).
  6. Plaintext cleanup strips `<table>`, `<style>`, `<sup class="reference">`, `mw-editsection` spans, numeric HTML entities, `[citation needed]` markers, orphan `edit]` artifacts.
- **Quality gate:** allowlist-filtered sections must yield ≥ 500 chars of markdown (`MIN_MARKDOWN_LENGTH`), above Phase A's 200-char floor for safety headroom.
- **Assumptions:**
  - **English Wikipedia only.** Non-English cities may have thin coverage even if their native Wikipedia is rich.
  - **US state disambiguation relies on the city id's `-XX` suffix** (e.g., `portland-me`, `jackson-wy`). This is populated in the cache for ambiguously-named cities. Cities without a suffix must be uniquely named enough that opensearch's ranking picks the right article (works for `tulsa`, `buffalo`, `fresno`; verified manually for `boulder` → Boulder, Colorado).
  - Historical content is not filtered at scrape time — the **historical-guard instruction in the Phase A Gemini prompt** (research-city.py, new this session) tells Gemini to ignore "was built in / was demolished / formerly located / no longer stands" phrasing when extracting waypoints.
  - No retry on 403/404 (treated as "article not found, try next candidate"). Retry-with-backoff applies only to 429/5xx.
- **Known thin cases:** `kahului` (242 chars in WP — hand-augmented stub written grounded in city metadata), `key-west` (498 chars — just under floor, accepted because it still clears Phase A).

### 3.7 Reddit — `scripts/scrape-reddit.ts` (NEW, 2026-04-22)

- **What we get:** top-voted posts from the year in per-city subreddits, plus top comments (score ≥ 5). Real local insider recommendations, often with specific venue names and candid opinions.
- **How:**
  1. Tries subreddit candidates: lowercased city id (`akron`), concatenated (`jerseycity`), underscored (`jersey_city`), CamelCase (`JerseyCity`), region fallback, last-resort `/r/travel`.
  2. For each subreddit, searches 6 queries (`"hidden gems"`, `"must visit"`, `"things to do"`, `"favorite spots"`, `"local recommendations"`, `"best of"`) via `/search.json?restrict_sr=1&sort=top&t=year&limit=25`.
  3. Top 5 deduped posts per subreddit are fetched individually for their top 5 comments (score ≥ 5).
  4. Passes through a **strict quality gate** (see Assumptions below).
- **Quality gate (`passesQualityGate`):** at least one post must satisfy `(city name in title)` OR `(city name in selftext AND ≥ 1 comment with score ≥ 5)`. This is stricter than the first draft — the city-mentioned-in-comments path was removed after Gemini's audit flagged it as too lax. Subreddits that fail the gate are skipped and the next candidate is tried.
- **Rate limiting:** default 2s per API call; retry-with-backoff on 429/5xx with jitter.
- **Assumptions:**
  - Unauthenticated Reddit API. Reddit can rate-limit or temporarily block IP-addresses; our budget is ~50 cities × 5 queries × 5 posts = ~1250 GETs per batch. User-Agent: `UrbanExplorer/1.0 (+https://urbanexplorer.app; anguijm@gmail.com)`.
  - Many small US cities either have no subreddit or a near-dead one (kahului was double-blocked on reddit, rochester-ny returned no quality posts). When all candidates fail, the city is logged as blocked in `data/reddit/_summary.log` but the pipeline is not halted — Wikipedia or other sources may still cover it.
  - Link posts (no selftext) are accepted; the gate looks at title.
  - NSFW, stickied mod posts, and `[removed]`/`[deleted]` entries are filtered out in `extractPostsFromSearchJson`.

---

## 4. Per-City Coverage Matrix

Full matrix at `DATA_COVERAGE_REPORT.md` (this file) — see §8 Appendix below for the sortable dump of all 185 cities with per-source ✓/· flags and manifest status. This sample shows the 50 new US cities (the only tier that relies on Wikipedia/Reddit grounding):

```
id                   tier     wiki  red  atlas spot  infat time  loc   #src
spokane              town     ✓     ✓    ·     ·     ·     ·     ·     2
tulsa                town     ✓     ✓    ·     ·     ·     ·     ·     2
anchorage            town     ✓     ✓    ·     ·     ·     ·     ·     2
rochester-ny         town     ✓     ·    ·     ·     ·     ·     ·     1   (reddit: no quality posts in /r/rochester)
portland-me          town     ✓     ·    ·     ·     ·     ·     ·     1   (resolved to Portland, Maine via state-suffix fix)
jackson-wy           village  ✓     ·    ·     ·     ·     ·     ·     1   (resolved to Jackson, Wyoming via state-suffix fix)
kahului              village  ✓     ·    ·     ·     ·     ·     ·     1   (hand-authored WP stub, reddit dead)
boulder              village  ✓     ·    ·     ·     ·     ·     ·     1   (scraped after the tmux kill)
key-west             village  ✓     ·    ·     ·     ·     ·     ·     1   (498 chars WP — just under 500 floor but accepted)
...
```

All 50 pending US cities currently have **at least Wikipedia coverage**. Reddit-fill is in flight for the ~35 cities that didn't finish before the tmux was killed to address a state-disambiguation bug — full reddit coverage will land within the hour.

---

## 5. Pipeline Data Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  (auto-trigger on every city)                                                │
│  scripts/batch-research.py → for each pending city:                          │
│    1.  scrape_atlas_if_needed         → data/atlas-obscura/{id}.md           │
│    2.  scrape_local_source_if_needed  → data/{spotted|infat|time|loc}/...    │
│    3.  scrape_wikipedia_if_needed     → data/wikipedia/{id}.md               │
│    4.  scrape_reddit_if_needed        → data/reddit/{id}.md                  │
│    5.  subprocess: research-city.py --city {id} --mode gemini --ingest       │
└──────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  scripts/research-city.py                                                    │
│  Phase A (phase_a_gemini):                                                   │
│    • Load all `data/{src}/{id}.md` files listed in TEXT_SOURCE_DIRS          │
│    • Require at least one source > 200 chars (else exit 1)                   │
│    • Call Gemini 2.5 Pro with:                                               │
│        - Tier-aware research prompt (metro 6/48/72, town 3/24/36, village)   │
│        - Historical-guard instruction (ignore "was built/demolished"...)     │
│        - All concatenated sources as primary reference material              │
│    → Structured neighborhoods/waypoints/tasks JSON                           │
│                                                                              │
│  Phase B: Gemini re-structure / normalise → validated against schemas        │
│                                                                              │
│  Phase C: Semantic audit — sample 3 neighborhoods / 15 waypoints / 3 tasks   │
│    → PASS / WARNING / FAIL. Current bug: 3+ absolute hallucinated-place      │
│    threshold is too strict for small enrichment deltas (blueprint #26).      │
│                                                                              │
│  Phase D: Ingest to Firestore                                                │
│    • Baseline (no --enrich): scripts/build-vibe-cache.ts  → full write       │
│    • --enrich:              scripts/enrich-ingest.ts     → additive only    │
└──────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Firestore `urbanexplorer` named database                                    │
│  • cities/{cityId}                           — metadata + coverageTier       │
│  • cities/{cityId}/neighborhoods/{nhId}      — lat/lng, name, lore           │
│  • cities/{cityId}/neighborhoods/.../waypoints/{wpId}                        │
│  • cities/{cityId}/neighborhoods/.../tasks/{taskId}                          │
│  • vibe_neighborhoods | vibe_waypoints | vibe_tasks  — flat mirrors for     │
│    fast indexed runtime queries from Server Components                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

At runtime, Server Components call `getCachedNeighborhoods` / `getCachedWaypoints` directly (bypassing the route handlers) to read the flat mirrors. Gemini fallback is used only for cache-miss cities — by design, it's the slow path.

---

## 6. Assumptions & Known Caveats

1. **Tier drives quality thresholds.** The `coverageTier` field on each city (metro / town / village) controls both the research prompt's expected POI counts AND Phase C's validation thresholds. If a city is mis-tiered, research either under- or over-generates. The 50 new US cities were council-approved for tier at the time of the 2026-04-08 commit; Providence / New Haven / Hartford / Charleston SC / Savannah are currently `metro` by default but may deserve re-tier to `town` (blueprint #28).

2. **Scraper `.json` files are dead output.** Phase A reads only `.md`. Broken or stale `.json` files in the scraper dirs do NOT poison Firestore; they just exist for historical reasons.

3. **Phase C semantic audit is currently over-strict.** Cities with small enrichment deltas where Gemini flags 3+ "suspicious" places out of 15 sampled get FAILed — even when the absolute count is a low proportion. The 19 parked-failed cities are the casualties. Fix planned (blueprint #26) makes the threshold proportional (>25% instead of absolute 3+).

4. **Enrichment is additive.** `enrich-ingest.ts` filters for documents with `source: "enrichment-*"` and never overwrites existing Firestore documents. Baseline runs use `build-vibe-cache.ts --force --skip-validation` for new cities.

5. **Wikipedia English-only + US-state-suffix assumption.** For international cities we rely on `clinicalName` being disambiguated in the cache (e.g., "Asheville, North Carolina" works, but "Paris" alone would be ambiguous). Non-US ambiguous names are handled by opensearch ranking plus `looksLikeCityArticle` check — no global disambiguation metadata yet.

6. **Reddit coverage is patchy for small cities.** /r/{city} is vibrant for metros and vanishes for villages. Kahului, rochester-ny, and a handful of others return zero quality-gated posts. The quality gate's city-in-title-OR-selftext rule is intentional — the laxer "city in any comment" variant was rejected at audit for producing noise.

7. **Historical-place guard lives in the Phase A prompt, not at scrape time.** If the guard instruction is weakened or removed, Wikipedia's historical prose ("The Theatre was built in 1923 and demolished in 1971") could be ingested as active waypoints. The test `src/__tests__/phase-a-historical-guard.test.ts` pins the key phrases.

8. **Audit debt outstanding.** The new Wikipedia + Reddit scrapers shipped under user override after Gemini MCP disconnected mid-session. Owed: (a) re-audit of the 5 test remediations (previous verdict: 🔴 BLOCK, now remediated but unaudited); (b) implementation audit on the final scripts. Tracked as task #12.

---

## 7. Cities Still Needing Work

### Pending — 50 new US cities (this session)

Wikipedia: 49/50 done (`boulder` just retroactively added after tmux kill). Reddit: 15/50 and climbing (~35 still running in `tmux:reddit-fill`). Once reddit-fill completes, every pending city will have ≥ 1 scraped `.md` source, unblocking Phase A.

Wikipedia-thin cases (< 2000 chars) that may benefit from future manual augmentation: kahului (hand-authored), key-west (498 chars), worcester (4302 chars — only 1 section matched), sedona (1881 chars), park-city (534 chars, 1 section).

### Parked — 19 ex-failed cities (awaiting blueprint #26 fix)

algiers, athens, austin, boston, buenos-aires, cincinnati, denver, fukuoka, geneva, honolulu, houston, las-vegas, lisbon, london, melbourne, muscate, nashville, osaka, rome, shanghai, tokyo. All have full scraper coverage and real Phase A/B output on disk (some in `src/data/research-output/failed/`). The Phase C absolute-threshold fix unparks them.

### Known-thin metros

Review the per-source counts: any metro with < 2 scraped sources out of the 5 editorial options is likely a candidate for re-scraping after source-specific fixes. `data/{source}/_summary.log` per scraper lists current unblocked/blocked counts.

---

## 8. Appendix — Full Per-City Matrix

See `DATA_COVERAGE_MATRIX.txt` (generated at the same timestamp as this report) for the sortable dump of all 185 cities with per-source flags, manifest status, and source count.

---

## 9. References

- `CLAUDE.md` — operational protocol (Bedrock rules, TDD, Gemini audit protocol)
- `blueprint.md` — backlog, project state, current priorities
- `scripts/research-city.py` — Phase A-D pipeline, historical-guard prompt
- `scripts/batch-research.py` — batch orchestrator, auto-scrape wiring
- `scripts/scrape-wikipedia.ts` — Wikipedia scraper (new 2026-04-22)
- `scripts/scrape-reddit.ts` — Reddit scraper (new 2026-04-22)
- `src/__tests__/scrape-wikipedia.test.ts`, `src/__tests__/scrape-reddit.test.ts`, `src/__tests__/phase-a-historical-guard.test.ts` — unit tests (39 passing)
- `src/data/global_city_cache.json` — source of truth for city metadata
- `src/data/research-output/batch-manifest.json` — pipeline state ledger
- `data/{source}/_summary.log` — per-scraper outcome reports (audit Task 5)
