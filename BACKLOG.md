# Backlog — city-atlas-service

> Living priority tracker. Re-rank as priorities shift; one line per item.
> For long-form session learnings see `.harness/learnings.md`.
> For start-here-next-session block see `SESSION_HANDOFF.md`.
>
> Last refreshed: 2026-04-26.

## Now (this week)

- **Council infra fix** — Extend `.harness/scripts/council.py` to fetch prior council comment + submitter response and prepend to round-N persona prompts. Eliminates the override-paperwork tax on substantive PRs. ([#16](https://github.com/Anguijm/city-atlas-service/issues/16))
- **Honolulu recovery** — `mv data/research-output/failed/honolulu.json data/research-output/honolulu.json && python src/pipeline/research_city.py --city honolulu --ingest-only --enrich`. Closes 15/16 → 16/16 on the 2026-04-08 parked-metros backlog. (no issue; one-step manual op)
- **CI smoke-test on entry-point scripts** — Three porting-miss bugs landed in prior sessions (`90b8c2a`, `f627d83`, `1f173b7`); pattern is well-established. File-and-design before the next porting cycle introduces a fourth. ([#12](https://github.com/Anguijm/city-atlas-service/issues/12))

## Next (queued, scoped)

- **Unit tests for `geoBoundsFor` + Infatuation HTML fixtures** — Round-2 council ask on PR #15, deferred. Pure-function test + 3 captured HTML states (success, no-results, error). ([#17](https://github.com/Anguijm/city-atlas-service/issues/17))
- **Phase A prompt-injection markers** — Wrap scraped content in boundary markers across all 6 scraper outputs (not partial); meta-prompt instruction to treat as untrusted. Council reviewers re-raise this every PR that touches scrapers. ([#7](https://github.com/Anguijm/city-atlas-service/issues/7))
- **Tier-aware deletion floor** — Phase C threshold currently uses a single proportional `>25%` rule; village-tier cities with small audit samples get unfair rejections. ([#6](https://github.com/Anguijm/city-atlas-service/issues/6))
- **SRE: AUDIT_DELETION alert pipe** — Cloud Logging → BigQuery → Alert Policy on aggregate hallucination rate. Outside this code repo's diff scope; lives in infra. ([#5](https://github.com/Anguijm/city-atlas-service/issues/5))
- **Subprocess city-ID sanitization** — `batch_research.py` passes `city_id` straight into subprocess calls; defensive sanitization is one-line. ([#8](https://github.com/Anguijm/city-atlas-service/issues/8))
- **Role-based UA email** — Replace personal email in scraper User-Agent strings with a role address. Information-disclosure hygiene. ([#9](https://github.com/Anguijm/city-atlas-service/issues/9))

## Someday (architecture / daydreams)

- **Admin web interface for POI find/add/edit** — Paste-URL-or-info to add or correct waypoints without re-running the pipeline. Backend writes with `source: "admin-manual"` parallel to `enrichment-*`. Force-multiplier once the bulk-ingest backlog is cleared. ([#14](https://github.com/Anguijm/city-atlas-service/issues/14))
- **Language-aware Phase A** — Geneva + Lisbon failed Phase C because English-only sources are thin; Phase B fabricates over the gap. Either a `--language` flag in Phase A's prompt, or non-English source scrapers (French Wikipedia for Geneva, Portuguese Reddit for Lisbon). No issue yet; would be filed when actively scoped.
- **London manifest mystery** — London is in `configs/global_city_cache.json` but absent from `manifest.cities`. Quick-cause-finder wasn't done; low priority while everything else works.
- **Persona prompt strengthening** — Several round-2 council asks have been "verify X" where the reviewer could verify themselves (`jq` over the city cache answers most of these). Tighten persona prompts to "check yourself, then ask only if there's a problem." Layer 3 of the council-tightening plan after #16.

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
| [#16](https://github.com/Anguijm/city-atlas-service/issues/16) | Council infrastructure: pass prior remediations + submitter response into round-N prompt | Highest-leverage council fix; ~50–80 lines in `council.py`. |
| [#17](https://github.com/Anguijm/city-atlas-service/issues/17) | Unit tests for geoBoundsFor + Infatuation scraper fixtures | Round-2 #4 on PR #15, deferred follow-up. |

## In flight (branches not yet merged)

_None._ Working tree clean as of 2026-04-26.

## Recently closed

- **#11** — Scraper refinement (Atlas Obscura URL pattern, Infatuation finder, retire SBL). Closed by PR #15 (`1f04365`) on 2026-04-26.
- **#10** — Scraper malfunction on parked metros. Closed in prior session via `f627d83`.
- **PR #18** — CLAUDE.md round-N drift doctrine + submitter-response format. Merged `4522361`.
