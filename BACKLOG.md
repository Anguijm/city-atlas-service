# Backlog — city-atlas-service

> Living priority tracker. Re-rank as priorities shift; one line per item.
> For long-form session learnings see `.harness/learnings.md`.
> For start-here-next-session block see `SESSION_HANDOFF.md`.
>
> Last refreshed: 2026-04-27 (session 2 close).

## Now (this week)

- **Issue #21 — automate branch-guard preflight inside pipeline entry points.** PR #27's 4-attempt retry pattern is the copy-pasteable template. Also the right place for a Phase-C-bypass guard on `--ingest-only` against `data/research-output/failed/` files. ([#21](https://github.com/Anguijm/city-atlas-service/issues/21))
- **Issue #8 — sanitize city-ID arguments in `batch_research.py` subprocess calls.** One-line allow-list (`^[a-z0-9-]+$`). Prerequisite for incremental-queue and ops-console items. ([#8](https://github.com/Anguijm/city-atlas-service/issues/8))
- **Issue #33 — tsconfig isolation PR.** The CommonJS→ESNext+Bundler migration bundled into PR #26 to fix pre-existing CI should be isolated and council-reviewed on its own. Low-risk, easy to close. ([#33](https://github.com/Anguijm/city-atlas-service/issues/33))

## Next (queued, scoped)

- **Unit tests for `geoBoundsFor` + Infatuation HTML fixtures + `fetch_prior_round_context`** — Original scope (PR #15 R2) plus PR #30 council R1 #3 / R2 #2 OOS extension. Pure-function test + HTML fixtures + council.py parser edge cases. ([#17](https://github.com/Anguijm/city-atlas-service/issues/17))
- **CI smoke-test on entry-point scripts** — Three porting-miss bugs landed in prior sessions (`90b8c2a`, `f627d83`, `1f173b7`); pattern is well-established. File-and-design before the next porting cycle introduces a fourth. ([#12](https://github.com/Anguijm/city-atlas-service/issues/12))
- **Phase A prompt-injection markers** — Wrap scraped content in boundary markers across all 6 scraper outputs (not partial); meta-prompt instruction to treat as untrusted. Council reviewers re-raise this every PR that touches scrapers. ([#7](https://github.com/Anguijm/city-atlas-service/issues/7))
- **Tier-aware deletion floor** — Phase C threshold currently uses a single proportional `>25%` rule; village-tier cities with small audit samples get unfair rejections. ([#6](https://github.com/Anguijm/city-atlas-service/issues/6))
- **Role-based UA email** — Replace personal email in scraper User-Agent strings with a role address. Information-disclosure hygiene. ([#9](https://github.com/Anguijm/city-atlas-service/issues/9))
- **SRE: AUDIT_DELETION alert pipe** — Cloud Logging → BigQuery → Alert Policy on aggregate hallucination rate. Outside this code repo's diff scope; lives in infra. ([#5](https://github.com/Anguijm/city-atlas-service/issues/5))

## Someday (architecture / daydreams)

- **Admin web interface for POI find/add/edit** — Paste-URL-or-info to add or correct waypoints without re-running the pipeline. Backend writes with `source: "admin-manual"` parallel to `enrichment-*`. Force-multiplier once the bulk-ingest backlog is cleared. ([#14](https://github.com/Anguijm/city-atlas-service/issues/14))
- **Firestore composite indexes for new waypoint fields** — No query pattern for `last_validated`, `google_place_id`, `business_status`, `is_active` exists yet. Add indexes when the first field-level query is written; Firestore will error with a direct link to the required index definition. ([#32](https://github.com/Anguijm/city-atlas-service/issues/32))
- **Honolulu count bump** — Current ingest is 5 nbhd / 19 wp / 100 tasks (`quality_status: degraded`). Run `python src/pipeline/research_city.py --city honolulu --enrich` (no `--ingest-only`) to invoke Phase B's find-new-places pass + additive re-ingest. Priority depends on whether UE/Roadtripper surface degraded cities to users. (no issue)
- **Land the `urbanexplorer` → `travel-cities` rename** — Six call sites (`enrich_ingest.ts:25`, `build_cache.ts:601,1073`, `qc_cleanup.ts:26`, `backfill_task_neighborhoods.ts:30`, `firestore/admin.ts:20`) plus a Firestore named-database migration. Either land it or stop calling it planned. (no issue)
- **GitHub Pro for hard branch protection** — Branch-guard is post-hoc detection; Pro ($4/mo) or making the repo public would enable preventative branch protection. Revisit if a second contributor joins. (no issue)
- **Language-aware Phase A** — Geneva + Lisbon failed Phase C because English-only sources are thin. Either a `--language` flag in Phase A's prompt, or non-English source scrapers. (no issue)
- **London manifest mystery** — London is in `configs/global_city_cache.json` but absent from `manifest.cities`. Low priority while everything else works. (no issue)
- **Persona prompt strengthening** — Tighten council personas to "check yourself, then ask only if there's a problem." Reduces "verify X" asks where the reviewer could verify via `jq`. Layer 3 of council-tightening plan (layers 1+2 shipped in PR #30).

## Open issues (mirror of `gh issue list --state open`)

| # | Title | One-line context |
|---|---|---|
| [#5](https://github.com/Anguijm/city-atlas-service/issues/5) | SRE: alert pipe on aggregate AUDIT_DELETION waypoint count | Out-of-repo infra; deferred. |
| [#6](https://github.com/Anguijm/city-atlas-service/issues/6) | Tier-aware deletion floor for small Phase C audit samples | Phase C threshold tuning for village-tier cities. |
| [#7](https://github.com/Anguijm/city-atlas-service/issues/7) | Security: prompt-injection defense for scraped content in Phase A Gemini prompt | Boundary markers + ignore-instructions across all 6 sources. |
| [#8](https://github.com/Anguijm/city-atlas-service/issues/8) | Security: sanitize city-ID arguments in batch_research.py subprocess calls | One-line defensive add; prerequisite for ops-console. |
| [#9](https://github.com/Anguijm/city-atlas-service/issues/9) | Security: replace personal email with role-based address in scraper User-Agents | Info-disclosure hygiene. |
| [#12](https://github.com/Anguijm/city-atlas-service/issues/12) | CI smoke-test on entry-point scripts to catch porting-miss bugs at port time | Three-data-points bug class; CI prevention earned. |
| [#14](https://github.com/Anguijm/city-atlas-service/issues/14) | Admin web interface: find/add/edit POIs by URL or pasted info | UE/Roadtripper-adjacent admin tool; not blocking. |
| [#17](https://github.com/Anguijm/city-atlas-service/issues/17) | Unit tests for geoBoundsFor + Infatuation scraper fixtures + fetch_prior_round_context | Extended scope: original PR #15 R2 ask + PR #30 OOS extension. |
| [#21](https://github.com/Anguijm/city-atlas-service/issues/21) | Automate branch-guard preflight inside pipeline entry points | PR #20 R3 ask; defense-in-depth on production writes. |
| [#32](https://github.com/Anguijm/city-atlas-service/issues/32) | Add Firestore composite indexes when query patterns are implemented | Deferred until field-level queries exist; Firestore error will signal. |
| [#33](https://github.com/Anguijm/city-atlas-service/issues/33) | tsconfig: move ESNext+Bundler module migration to a dedicated PR | Bundling concern from PR #26 council; easy to close with an isolated PR. |

## In flight (branches not yet merged)

None. `main` is clean.

## Recently closed

- **PR #26** — Schema alignment: `WaypointSchema` + `NeighborhoodSchema` additions (`google_place_id`, `business_status`, `last_validated`, `is_active`, `source`, `enriched_at`). Also fixed pre-existing CI: tsconfig CommonJS→ESNext+Bundler, Node 20.11.0→22.11.0, test fixture type errors. Admin-merged `55c8715` after R1 🟢 (schema only) + R2+R3 🔴 (triggered by bundled CI-fix commits; R3 drift: tsconfig "deferred" → "required", security 10→4 with no changes). Filed #32 (indexes), #33 (tsconfig isolation).
- **PR #31** — Session-close docs for 2026-04-27 (session 1). Squash-merged `c07a092`.
- **PR #30** — Council cross-round memory (#16) + score-rule tightening (#23). Admin-merged `18f150e` after R1 🔴 → R2 🔴 (security went 3→9 confirming the fix worked; residual BLOCKs were R1 "at-minimum" path contradicted by R2, and re-raise of previously-argued-OOS unit tests). #16 and #23 auto-closed.
- **PR #29** — Session-close docs for 2026-04-26 (pt4). Squash-merged `cb419fd`.
- **PR #28** — pt3 session-close docs (branch-guard retry fix + Honolulu recovery docs). Admin-merged `9d21015` after R1 🔴 → R2 🔴. R1 cost=1 with empty body → R2 cost=10 with substantive body on the same diff = canonical #23 score-noise evidence.
- **PR #27** — Branch-guard retry-with-backoff for GitHub API eventual consistency (`95c29ce`). R1 🟢 CLEAR.
- **Honolulu (no issue)** — Parked-metros backlog now **16/16**. Ingested via `enrich_ingest.ts` additive path: 5 neighborhoods / 19 waypoints / 100 tasks / `coverageTier: metro` / `quality_status: degraded`.
  - **⚠ DANGER — one-off recovery for a TRANSIENT WRITE ERROR, not a general recipe.** Honolulu's Phase A/B/C ran successfully. The original failure was the pre-`1f173b7` `--ingest-only` flag-routing bug. DO NOT use `--ingest-only --enrich` for any city parked in `failed/` because Phase C rejected it — that bypasses the semantic gate. Use `python src/pipeline/research_city.py --city <X> --enrich` for those.
