# Backlog — city-atlas-service

> Living priority tracker. Re-rank as priorities shift; one line per item.
> For long-form session learnings see `.harness/learnings.md`.
> For start-here-next-session block see `SESSION_HANDOFF.md`.
>
> Last refreshed: 2026-04-28 (session close).

## Now (this week)

- **Issue #37 — tiered quality gates by `coverageTier`** — implement BEFORE running the 97-city research batch. Scraper char thresholds, coverageTier-aware prompt variant, QC floor scaling. `coverageTier` already in schema; no schema changes needed. ([#37](https://github.com/Anguijm/city-atlas-service/issues/37))
- **Merge `scrape/100-new-cities` PR + run research (after #37 lands)** — pre-flight: Firestore export backup + 10-city dry run + branch-guard green. Then `batch_research.py --no-limit --ingest` for 97 cities (moab-ut/crested-butte-co/rapid-city-sd deferred until #37 lowers village floor).
- **Issue #21 — automate branch-guard preflight inside pipeline entry points.** PR #27's 4-attempt retry pattern is the template. ([#21](https://github.com/Anguijm/city-atlas-service/issues/21))
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
| [#37](https://github.com/Anguijm/city-atlas-service/issues/37) | Tiered quality gates by coverageTier (village/town/metro) | Filed 2026-04-28; next major pipeline work item. |

## In flight (branches not yet merged)

- **`scrape/100-new-cities`** — Wikipedia (89/92) + Reddit scraped data for the 100 new US cities added in PR #34. No code changes; data-only PR.
- **`add-100-us-cities`** — source branch for PR #34. Already merged; can be deleted.

## Recently closed

- **PR #34** — Expand US city coverage from 100 to 200 cities (285 total globally). CI city-cache-validate job. batch_research.py 25-city circuit breaker. Admin-merged `df1a69b` after 4 council rounds. Filed #36 (disambiguation audit — closed same session, PASS).
- **Issue #36** — Wikipedia scraper disambiguation audit. 8/8 pilot cities resolved correctly. Closed 2026-04-28 as PASS.
- **PR #26** — Schema alignment: `cityAtlas.ts` + `build_cache.ts` pipeline-emitted fields. Admin-merged `55c8715` after 3 rounds. Filed #32, #33.
- **PR #30** — Council cross-round memory (#16) + score-rule tightening (#23). Admin-merged `18f150e`. Closed #16, #23.
