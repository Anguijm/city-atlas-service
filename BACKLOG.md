# Backlog — city-atlas-service

> Living priority tracker. Re-rank as priorities shift; one line per item.
> For long-form session learnings see `.harness/learnings.md`.
> For start-here-next-session block see `SESSION_HANDOFF.md`.
>
> Last refreshed: 2026-05-07 (session 7 close).

## Now (this week)

- **11 permanently-thin US tier3 cities — need new data sources.** Current sources (Atlas Obscura + Wikipedia) produce too few POIs for these outdoor/rural destinations to pass Phase C reliably. Cities: `black-mountain-nc`, `camden-me`, `cannon-beach-or`, `crested-butte-co`, `kahului`, `lambertville-nj`, `lenox-ma`, `moab-ut`, `ouray-co`, `stowe-vt`, `telluride-co`. Unblocked by: TripAdvisor scraper, AllTrails integration, local tourism board scraping, or manual POI entry via #14. Not blocking — 277/288 cities live.
- **Issue #21 — automate branch-guard preflight inside pipeline entry points.** ([#21](https://github.com/Anguijm/city-atlas-service/issues/21))
- **Issue #8 — sanitize city-ID arguments in `batch_research.py` subprocess calls.** One-line allow-list (`^[a-z0-9-]+$`). ([#8](https://github.com/Anguijm/city-atlas-service/issues/8))

## Next (queued, scoped)

- **Issue #33 — tsconfig isolation PR.** The CommonJS→ESNext+Bundler migration bundled into PR #26 should be isolated and council-reviewed alone. Low-risk, easy to close. ([#33](https://github.com/Anguijm/city-atlas-service/issues/33))
- **Unit tests** — `geoBoundsFor` + Infatuation HTML fixtures + `fetch_prior_round_context` edge cases. ([#17](https://github.com/Anguijm/city-atlas-service/issues/17))
- **CI smoke-test on entry-point scripts** — `--help`/`--smoke` on each entry point catches the porting-miss bug class. ([#12](https://github.com/Anguijm/city-atlas-service/issues/12))
- **Phase A prompt-injection markers** — boundary markers across all scraper outputs; ignore-instructions guard. ([#7](https://github.com/Anguijm/city-atlas-service/issues/7))
- **Tier-aware Phase C deletion floor** — village-tier cities with small audit samples fail unfairly at current uniform threshold. Complementary to #37. ([#6](https://github.com/Anguijm/city-atlas-service/issues/6))
- **Role-based UA email** — replace personal email in scraper User-Agent strings. ([#9](https://github.com/Anguijm/city-atlas-service/issues/9))
- **SRE: AUDIT_DELETION alert pipe** — Cloud Logging → BigQuery → Alert Policy. Out-of-repo infra. ([#5](https://github.com/Anguijm/city-atlas-service/issues/5))

## Someday (architecture / daydreams)

- **Admin web interface for POI find/add/edit** — paste URL or info to add/correct waypoints without re-running the pipeline. ([#14](https://github.com/Anguijm/city-atlas-service/issues/14))
- **Firestore composite indexes** — no query patterns exist yet; add when the first field-level query is written. ([#32](https://github.com/Anguijm/city-atlas-service/issues/32))
- **`urbanexplorer` → `travel-cities` rename** — 6 call sites; needs a Firestore named-database migration alongside. Land or drop.
- **GitHub Pro for hard branch protection** — currently soft-fence via branch-guard; Pro/$4/mo enables preventative protection.
- **Language-aware Phase A** — Geneva + Lisbon fail because English-only sources are thin.
- **London manifest mystery** — in global_city_cache.json but absent from manifest.cities.
- **Persona prompt strengthening** — tighten council personas to reduce "verify X" asks (layer 3 of council-tightening plan).
- **Cloud Run + Cloud Scheduler host** — replace tmux with a scheduled pipeline job.
- **Firestore snapshot-before-cycle** — `gcloud firestore export` before each enrichment cycle; auto-prune >30 days.
- **Incremental queue** — priority queue reading `pending_research` Firestore collection; hot cities re-enriched daily, cold monthly.
- **Operator web console (`city-atlas-ops`)** — run control, backlog triage, data editor, quality readouts, access control.

## Open issues (mirror of `gh issue list --state open`)

| # | Title | One-line context |
|---|---|---|
| [#5](https://github.com/Anguijm/city-atlas-service/issues/5) | SRE: alert pipe on aggregate AUDIT_DELETION waypoint count | Out-of-repo infra; deferred. |
| [#6](https://github.com/Anguijm/city-atlas-service/issues/6) | Tier-aware deletion floor for small Phase C audit samples | Phase C threshold tuning for village-tier cities. |
| [#7](https://github.com/Anguijm/city-atlas-service/issues/7) | Security: prompt-injection defense for scraped content | Boundary markers + ignore-instructions across all 6 sources. |
| [#8](https://github.com/Anguijm/city-atlas-service/issues/8) | Security: sanitize city-ID arguments in batch_research.py subprocess calls | One-line defensive add; prerequisite for ops-console. |
| [#9](https://github.com/Anguijm/city-atlas-service/issues/9) | Security: replace personal email with role-based address in scraper User-Agents | Info-disclosure hygiene. |
| [#12](https://github.com/Anguijm/city-atlas-service/issues/12) | CI smoke-test on entry-point scripts | Three-data-points bug class; CI prevention earned. |
| [#14](https://github.com/Anguijm/city-atlas-service/issues/14) | Admin web interface: find/add/edit POIs by URL or pasted info | UE/Roadtripper-adjacent admin tool; not blocking. |
| [#17](https://github.com/Anguijm/city-atlas-service/issues/17) | Unit tests for geoBoundsFor + Infatuation fixtures + fetch_prior_round_context | Extended scope from PR #15 + PR #30 asks. |
| [#21](https://github.com/Anguijm/city-atlas-service/issues/21) | Automate branch-guard preflight inside pipeline entry points | Defense-in-depth on production writes. |
| [#32](https://github.com/Anguijm/city-atlas-service/issues/32) | Add Firestore composite indexes when query patterns are implemented | Deferred until field-level queries exist. |
| [#33](https://github.com/Anguijm/city-atlas-service/issues/33) | tsconfig: move ESNext+Bundler migration to a dedicated PR | Bundling concern from PR #26 council. |
| [#35](https://github.com/Anguijm/city-atlas-service/issues/35) | feat(pipeline): add circuit breaker to batch_research.py | Implemented in PR #34; open as tracking ref. |
| [#41](https://github.com/Anguijm/city-atlas-service/issues/41) | UE/Roadtripper: surface quality notice for degraded cities | Consumer-side: show quality_status: degraded banner in UE/RT. |
| [#47](https://github.com/Anguijm/city-atlas-service/issues/47) | Scrapers: use clinicalName for city disambiguation | oxford-ms + birmingham timeout scrapes fetched wrong-country data; systematic fix. |

## In flight (branches not yet merged)

_(none)_

## Recently closed

- **PR #46** — session 4 close docs + enrichment scrape data. Admin-merged (OOS BLOCK). Filed #47.
- **PR #45** — council harness alignment (DoW fix, budget serialization, drift-check workflow). 🟢 CLEAR. Merged.
- **PR #43** — corridor cities: louisville, birmingham, wichita, amarillo + research data. Admin-merged (OOS BLOCK, pre-existing scraper + security concerns). Filed #47 for Birmingham wrong-city scrape.
- **PR #42** — Phase B prompt injection defense: boundary-tag escaping + golden-file tests. Admin-merged R4 (round 3 vs round 4 contradiction on fixture neighborhood assignment; security 10/10 throughout). Closed.
- **PR #40** — session 3 close docs (with 500+ batch scrape data files). Rebased onto main, admin-merged (OOS BLOCK on pre-existing security issues). Closed.
- **PR #44** — `enrich_ingest.ts`: stripUndefined utility + Zod required-field validation before Firestore writes. 7 council rounds. Merged `7f7652c`.
- **PR #39** — Tiered quality gates by coverageTier (village/town/metro). Merged `7782539`. Closed #6, #37.
- **PR #38** — Scrape data for 100 new US cities (Wikipedia + Reddit). Merged `10bd5e1`.
- **PR #34** — Expand US city coverage from 100 to 200 cities (285 total globally). CI city-cache-validate job. batch_research.py 25-city circuit breaker. Admin-merged `df1a69b` after 4 council rounds.
- **Issue #36** — Wikipedia scraper disambiguation audit. 8/8 pilot cities resolved correctly. Closed 2026-04-28 as PASS.
- **PR #26** — Schema alignment: `cityAtlas.ts` + `build_cache.ts` pipeline-emitted fields. Admin-merged `55c8715` after 3 rounds. Filed #32, #33.
- **PR #30** — Council cross-round memory (#16) + score-rule tightening (#23). Admin-merged `18f150e`. Closed #16, #23.
