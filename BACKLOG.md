# Backlog — city-atlas-service

> Living priority tracker. Re-rank as priorities shift; one line per item.
> For long-form session learnings see `.harness/learnings.md`.
> For start-here-next-session block see `SESSION_HANDOFF.md`.
>
> Last refreshed: 2026-04-27.

## Now (this week)

- **PR #26 — schema alignment: address 4 R1 council remediations.** `enriched_at` backward-compat (accept `Z` + `+00:00` offset forms), composite indexes in `firestore.indexes.json`, security rules for new fields, null-handling note to consumers. Already has a council BLOCK; fix and push for round 2. ([PR #26](https://github.com/Anguijm/city-atlas-service/pull/26))
- **Automate branch-guard preflight inside pipeline entry points** — PR #27's 4-attempt retry pattern is the copy-pasteable template. Also the right place for a Phase-C-bypass guard on `--ingest-only` against `data/research-output/failed/` files. ([#21](https://github.com/Anguijm/city-atlas-service/issues/21))

## Next (queued, scoped)

- **CI smoke-test on entry-point scripts** — Three porting-miss bugs landed in prior sessions (`90b8c2a`, `f627d83`, `1f173b7`); pattern is well-established. File-and-design before the next porting cycle introduces a fourth. ([#12](https://github.com/Anguijm/city-atlas-service/issues/12))
- **Unit tests for `geoBoundsFor` + Infatuation HTML fixtures + `fetch_prior_round_context`** — Original scope (PR #15 R2) plus PR #30 council R1 #3 / R2 #2 OOS extension. Pure-function test + HTML fixtures + council.py parser edge cases. ([#17](https://github.com/Anguijm/city-atlas-service/issues/17))
- **Phase A prompt-injection markers** — Wrap scraped content in boundary markers across all 6 scraper outputs (not partial); meta-prompt instruction to treat as untrusted. Council reviewers re-raise this every PR that touches scrapers. ([#7](https://github.com/Anguijm/city-atlas-service/issues/7))
- **Tier-aware deletion floor** — Phase C threshold currently uses a single proportional `>25%` rule; village-tier cities with small audit samples get unfair rejections. ([#6](https://github.com/Anguijm/city-atlas-service/issues/6))
- **SRE: AUDIT_DELETION alert pipe** — Cloud Logging → BigQuery → Alert Policy on aggregate hallucination rate. Outside this code repo's diff scope; lives in infra. ([#5](https://github.com/Anguijm/city-atlas-service/issues/5))
- **Subprocess city-ID sanitization** — `batch_research.py` passes `city_id` straight into subprocess calls; defensive sanitization is one-line. ([#8](https://github.com/Anguijm/city-atlas-service/issues/8))
- **Role-based UA email** — Replace personal email in scraper User-Agent strings with a role address. Information-disclosure hygiene. ([#9](https://github.com/Anguijm/city-atlas-service/issues/9))

## Someday (architecture / daydreams)

- **Admin web interface for POI find/add/edit** — Paste-URL-or-info to add or correct waypoints without re-running the pipeline. Backend writes with `source: "admin-manual"` parallel to `enrichment-*`. Force-multiplier once the bulk-ingest backlog is cleared. ([#14](https://github.com/Anguijm/city-atlas-service/issues/14))
- **Honolulu count bump** — Current ingest is 5 nbhd / 19 wp / 100 tasks (`quality_status: degraded`). To bump the waypoint count toward typical-metro range, run `python src/pipeline/research_city.py --city honolulu --enrich` (no `--ingest-only`) to invoke Phase B's find-new-places pass + additive re-ingest. **Priority depends on the consumer-side `quality_status: degraded` contract.** Both consumers receive the `quality_status` field in the schema; whether they hide / dim / annotate degraded cities is each consumer's choice. If UE or Roadtripper treat `degraded` as "do not display," the count-bump is cosmetic. If a consumer displays degraded cities prominently, the count-bump becomes user-visible and should be P1. Verify consumer behavior before deciding priority. (no issue)
- **Land the `urbanexplorer` → `travel-cities` rename** — Six call sites (`enrich_ingest.ts:25`, `build_cache.ts:601,1073`, `qc_cleanup.ts:26`, `backfill_task_neighborhoods.ts:30`, `firestore/admin.ts:20`) plus a Firestore named-database migration. Currently the doctrine acknowledges the rename was planned-but-not-executed; either land it or stop calling it planned. (no issue yet)
- **GitHub Pro for hard branch protection** — Branch-guard is post-hoc detection; Pro ($4/mo) or making the repo public would enable preventative branch protection. Revisit if a second contributor joins or if direct-push paper trails accumulate. (no issue)
- **Language-aware Phase A** — Geneva + Lisbon failed Phase C because English-only sources are thin; Phase B fabricates over the gap. Either a `--language` flag in Phase A's prompt, or non-English source scrapers (French Wikipedia for Geneva, Portuguese Reddit for Lisbon). No issue yet; would be filed when actively scoped.
- **London manifest mystery** — London is in `configs/global_city_cache.json` but absent from `manifest.cities`. Quick-cause-finder wasn't done; low priority while everything else works.
- **Persona prompt strengthening** — Several round-2 council asks have been "verify X" where the reviewer could verify themselves (`jq` over the city cache answers most of these). Tighten persona prompts to "check yourself, then ask only if there's a problem." Layer 3 of the council-tightening plan (layers 1+2 = #16+#23, now shipped in PR #30).

## Open issues (mirror of `gh issue list --state open`)

| # | Title | One-line context |
|---|---|---|
| [#5](https://github.com/Anguijm/city-atlas-service/issues/5) | SRE: alert pipe on aggregate AUDIT_DELETION waypoint count | Out-of-repo infra; deferred. |
| [#6](https://github.com/Anguijm/city-atlas-service/issues/6) | Tier-aware deletion floor for small Phase C audit samples | Phase C threshold tuning for village-tier cities. |
| [#7](https://github.com/Anguijm/city-atlas-service/issues/7) | Security: prompt-injection defense for scraped content in Phase A Gemini prompt | Boundary markers + ignore-instructions across all 6 sources. |
| [#8](https://github.com/Anguijm/city-atlas-service/issues/8) | Security: sanitize city-ID arguments in batch_research.py subprocess calls | One-line defensive add. |
| [#9](https://github.com/Anguijm/city-atlas-service/issues/9) | Security: replace personal email with role-based address in scraper User-Agents | Info-disclosure hygiene. |
| [#12](https://github.com/Anguijm/city-atlas-service/issues/12) | CI smoke-test on entry-point scripts to catch porting-miss bugs at port time | Three-data-points bug class; CI prevention earned. |
| [#14](https://github.com/Anguijm/city-atlas-service/issues/14) | Admin web interface: find/add/edit POIs by URL or pasted info | UE/Roadtripper-adjacent admin tool; not blocking. |
| [#17](https://github.com/Anguijm/city-atlas-service/issues/17) | Unit tests for geoBoundsFor + Infatuation scraper fixtures + fetch_prior_round_context | Extended scope: original PR #15 R2 ask + PR #30 OOS extension. |
| [#21](https://github.com/Anguijm/city-atlas-service/issues/21) | Automate branch-guard preflight inside pipeline entry points | PR #20 R3 ask; defense-in-depth on production writes. |

## In flight (branches not yet merged)

- **`add-pipeline-emitted-waypoint-fields` (PR #26)** — Schema alignment: `WaypointSchema` + `NeighborhoodSchema` additions to match pipeline-emitted fields. Council R1 BLOCK with 4 remediations. Needs code fixes before round 2.

## Recently closed

- **PR #30** — Council cross-round memory (#16) + score-rule tightening (#23). Admin-merged `18f150e` after R1 🔴 → R2 🔴 (security went 3→9 confirming the prompt-injection fix; residual BLOCKs were same-surface drift — R1 "at minimum" option contradicted by R2, and re-raise of argued-OOS unit tests). #16 and #23 auto-closed.
- **PR #29** — Session-close docs for 2026-04-26 (pt4). Squash-merged `cb419fd`.
- **PR #28** — pt3 session-close docs (branch-guard retry fix + Honolulu recovery docs). Admin-merged `9d21015` after R1 🔴 → R2 🔴. R1 cost=1 with empty body → R2 cost=10 with substantive body on the same diff = canonical #23 score-noise evidence.
- **#25** — Branch-guard eventual-consistency false-positive. Closed by PR #27 (`95c29ce`) — 4-attempt retry with 5s/10s/15s backoff over the `gh api /commits/{sha}/pulls` lookup. Empirically validated: branch-guard ✓ on PR #27's own merge commit (the very class of bug the PR fixes), and again on PR #28's merge commit (`9d21015`).
- **Honolulu (no issue)** — Parked-metros backlog now **16/16**. Ingested via `enrich_ingest.ts` additive path: 5 neighborhoods / 19 waypoints / 100 tasks / `coverageTier: metro` / `quality_status: degraded` written to `urbanexplorer`.
  - **⚠ DANGER — this is a one-off recovery for a TRANSIENT WRITE ERROR, not a general recipe for any failed city.** Honolulu's Phase A/B/C ran *successfully* and produced a `quality_status: degraded` JSON. The original failure was a **transient write error** at the Firestore-ingest step — specifically the pre-`1f173b7` `--ingest-only` flag-routing bug (which dropped `--enrich` and routed through the strict baseline path that rejects degraded JSONs). That bug has been fixed; ingesting the existing JSON additively was therefore safe and equivalent to having ingested it correctly the first time.
  - **DO NOT use `--ingest-only --enrich` for any city that landed in `data/research-output/failed/` because Phase C rejected its content** (coordinate drift, hallucinated POIs, semantic-audit failure, etc.). Phase C is the load-bearing semantic gate and `--ingest-only` skips it; running this recipe on a Phase-C-rejected JSON would push known-bad data to production Firestore. The correct procedure for those cases is `python src/pipeline/research_city.py --city <X> --enrich` (no `--ingest-only`), which re-runs Phase B (find new places) and Phase C (semantic audit) before any Firestore write. If Phase C rejects again, the city stays parked and the recipe is NOT a way around that.
  - **Operator decision rule:** before running `--ingest-only` on anything in `failed/`, identify the original failure mode. If the JSON was produced cleanly and the ingest step is what failed, additive `--ingest-only --enrich` is safe. If Phase C is what rejected the city, do NOT bypass it. There is currently no programmatic enforcement of this rule — the file system does not distinguish "transient-write-failure" from "phase-c-rejected" inside `failed/`. Adding structured failure reasons (e.g. `failed/transient/` vs `failed/phase-c/`) would let the pipeline programmatically prevent misuse; tracked informally as a follow-up under #21.
- **#11** — Scraper refinement (Atlas Obscura URL pattern, Infatuation finder, retire SBL). Closed by PR #15 (`1f04365`) on 2026-04-26.
- **#10** — Scraper malfunction on parked metros. Closed in prior session via `f627d83`.
- **PR #18** — CLAUDE.md round-N drift doctrine + submitter-response format. Merged `4522361`.
- **PR #19** — CLAUDE.md honest doctrine + reality reconciliation (DB name, schema package, task collections). Admin-merged `c9f8985` after R1 PR-comment remediation fulfilled.
- **PR #20** — `.github/workflows/branch-guard.yml` post-hoc detector for direct pushes. Admin-merged `f3a9f5e` after R3 same-surface flip; legitimate ask filed as #21.
- **PR #22** — Branch-guard `pull-requests: read` permission fix (one-liner unblocking the workflow). Admin-merged `942dc50` after R2 scoring-rule misfire; root cause filed as #23.
- **PR #27** — Branch-guard retry-with-backoff for API eventual consistency. Squash-merged `95c29ce` after R1 🟢 CLEAR (10/10/10/10/6/10) — the first PR this session where the synthesizer correctly read `product: 6 + empty body` as no-impact rather than BLOCK-trigger.
