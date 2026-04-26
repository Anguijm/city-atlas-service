# Backlog — city-atlas-service

> Living priority tracker. Re-rank as priorities shift; one line per item.
> For long-form session learnings see `.harness/learnings.md`.
> For start-here-next-session block see `SESSION_HANDOFF.md`.
>
> Last refreshed: 2026-04-26 (pt3).

## Now (this week)

- **Council-tightening sprint: #16 + #23 together.** Same root cause family: the council can't prevent itself from drifting because it has no cross-round memory (#16) AND the lead-architect rule fires BLOCK on score noise from no-impact axes (#23). PR #20 burned 3 rounds and PR #22 burned 2 rounds for non-substantive reasons these two fixes address. PR #27 R1 happened to land 🟢 CLEAR with `product: 6` shape (the synthesizer made the right call once) — but #22 didn't, so the rule needs to be explicit, not implicit. ~80–120 lines combined. ([#16](https://github.com/Anguijm/city-atlas-service/issues/16), [#23](https://github.com/Anguijm/city-atlas-service/issues/23))
- **Automate branch-guard preflight inside pipeline entry points** — Round-3 council ask on PR #20, deferred. Real defense-in-depth on production writes; the manual preflight in CLAUDE.md is fallible. Helper called from each `--ingest`/`--ingest-only` entry point that refuses to run if branch-guard isn't green on HEAD. **PR #27's retry pattern (4-attempt loop with 5s/10s/15s backoff) is the copy-pasteable template** for the eventual-consistency handling this helper will need. ([#21](https://github.com/Anguijm/city-atlas-service/issues/21))

## Next (queued, scoped)

- **CI smoke-test on entry-point scripts** — Three porting-miss bugs landed in prior sessions (`90b8c2a`, `f627d83`, `1f173b7`); pattern is well-established. File-and-design before the next porting cycle introduces a fourth. ([#12](https://github.com/Anguijm/city-atlas-service/issues/12))
- **Unit tests for `geoBoundsFor` + Infatuation HTML fixtures** — Round-2 council ask on PR #15, deferred. Pure-function test + 3 captured HTML states (success, no-results, error). ([#17](https://github.com/Anguijm/city-atlas-service/issues/17))
- **Phase A prompt-injection markers** — Wrap scraped content in boundary markers across all 6 scraper outputs (not partial); meta-prompt instruction to treat as untrusted. Council reviewers re-raise this every PR that touches scrapers. ([#7](https://github.com/Anguijm/city-atlas-service/issues/7))
- **Tier-aware deletion floor** — Phase C threshold currently uses a single proportional `>25%` rule; village-tier cities with small audit samples get unfair rejections. ([#6](https://github.com/Anguijm/city-atlas-service/issues/6))
- **SRE: AUDIT_DELETION alert pipe** — Cloud Logging → BigQuery → Alert Policy on aggregate hallucination rate. Outside this code repo's diff scope; lives in infra. ([#5](https://github.com/Anguijm/city-atlas-service/issues/5))
- **Subprocess city-ID sanitization** — `batch_research.py` passes `city_id` straight into subprocess calls; defensive sanitization is one-line. ([#8](https://github.com/Anguijm/city-atlas-service/issues/8))
- **Role-based UA email** — Replace personal email in scraper User-Agent strings with a role address. Information-disclosure hygiene. ([#9](https://github.com/Anguijm/city-atlas-service/issues/9))

## Someday (architecture / daydreams)

- **Admin web interface for POI find/add/edit** — Paste-URL-or-info to add or correct waypoints without re-running the pipeline. Backend writes with `source: "admin-manual"` parallel to `enrichment-*`. Force-multiplier once the bulk-ingest backlog is cleared. ([#14](https://github.com/Anguijm/city-atlas-service/issues/14))
- **Honolulu count bump** — Current ingest is 5 nbhd / 19 wp / 100 tasks (`quality_status: degraded`). To bump the waypoint count toward typical-metro range, run `python src/pipeline/research_city.py --city honolulu --enrich` (no `--ingest-only`) to invoke Phase B's find-new-places pass + additive re-ingest. Optional; only if 19 waypoints proves too thin in consumer use. (no issue)
- **Land the `urbanexplorer` → `travel-cities` rename** — Six call sites (`enrich_ingest.ts:25`, `build_cache.ts:601,1073`, `qc_cleanup.ts:26`, `backfill_task_neighborhoods.ts:30`, `firestore/admin.ts:20`) plus a Firestore named-database migration. Currently the doctrine acknowledges the rename was planned-but-not-executed; either land it or stop calling it planned. (no issue yet)
- **GitHub Pro for hard branch protection** — Branch-guard is post-hoc detection; Pro ($4/mo) or making the repo public would enable preventative branch protection. Revisit if a second contributor joins or if direct-push paper trails accumulate. (no issue)
- **Language-aware Phase A** — Geneva + Lisbon failed Phase C because English-only sources are thin; Phase B fabricates over the gap. Either a `--language` flag in Phase A's prompt, or non-English source scrapers (French Wikipedia for Geneva, Portuguese Reddit for Lisbon). No issue yet; would be filed when actively scoped.
- **London manifest mystery** — London is in `configs/global_city_cache.json` but absent from `manifest.cities`. Quick-cause-finder wasn't done; low priority while everything else works.
- **Persona prompt strengthening** — Several round-2 council asks have been "verify X" where the reviewer could verify themselves (`jq` over the city cache answers most of these). Tighten persona prompts to "check yourself, then ask only if there's a problem." Layer 3 of the council-tightening plan after #16 + #23.

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
| [#16](https://github.com/Anguijm/city-atlas-service/issues/16) | Council infrastructure: pass prior remediations + submitter response into round-N prompt | Highest-leverage council fix; ~50–80 lines in `council.py`. Pair with #23. |
| [#17](https://github.com/Anguijm/city-atlas-service/issues/17) | Unit tests for geoBoundsFor + Infatuation scraper fixtures | Round-2 #4 on PR #15, deferred follow-up. |
| [#21](https://github.com/Anguijm/city-atlas-service/issues/21) | Automate branch-guard preflight inside pipeline entry points | PR #20 R3 ask; defense-in-depth on production writes. |
| [#23](https://github.com/Anguijm/city-atlas-service/issues/23) | Lead-architect rule: 'any reviewer ≤4 → BLOCK' fires on no-impact scoring | One-line `.harness/council/lead-architect.md` edit. Pair with #16. |

## In flight (branches not yet merged)

- **`docs/session-close-2026-04-26-pt3`** — this very session's close docs (this BACKLOG.md update, learnings.md append, SESSION_HANDOFF.md refresh).

## Recently closed

- **#25** — Branch-guard eventual-consistency false-positive. Closed by PR #27 (`95c29ce`) — 4-attempt retry with 5s/10s/15s backoff over the `gh api /commits/{sha}/pulls` lookup. Empirically validated: branch-guard ✓ on PR #27's own merge commit (the very class of bug the PR fixes).
- **Honolulu (no issue)** — Parked-metros backlog now **16/16**. Ingested via `enrich_ingest.ts` additive path: 5 neighborhoods / 19 waypoints / 100 tasks / `coverageTier: metro` / `quality_status: degraded` written to `urbanexplorer`.
- **#11** — Scraper refinement (Atlas Obscura URL pattern, Infatuation finder, retire SBL). Closed by PR #15 (`1f04365`) on 2026-04-26.
- **#10** — Scraper malfunction on parked metros. Closed in prior session via `f627d83`.
- **PR #18** — CLAUDE.md round-N drift doctrine + submitter-response format. Merged `4522361`.
- **PR #19** — CLAUDE.md honest doctrine + reality reconciliation (DB name, schema package, task collections). Admin-merged `c9f8985` after R1 PR-comment remediation fulfilled.
- **PR #20** — `.github/workflows/branch-guard.yml` post-hoc detector for direct pushes. Admin-merged `f3a9f5e` after R3 same-surface flip; legitimate ask filed as #21.
- **PR #22** — Branch-guard `pull-requests: read` permission fix (one-liner unblocking the workflow). Admin-merged `942dc50` after R2 scoring-rule misfire; root cause filed as #23.
- **PR #27** — Branch-guard retry-with-backoff for API eventual consistency. Squash-merged `95c29ce` after R1 🟢 CLEAR (10/10/10/10/6/10) — the first PR this session where the synthesizer correctly read `product: 6 + empty body` as no-impact rather than BLOCK-trigger.
