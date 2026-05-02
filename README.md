# city-atlas-service

Batch data pipeline that builds the shared city atlas consumed by **Urban Explorer** and **Roadtripper**.

## What it does

1. **Scrapes** six public sources per city (Atlas Obscura, The Infatuation, TimeOut, Locationscout, Wikipedia, Reddit) into markdown.
2. **Synthesizes** the scraped content through four Gemini-powered phases — research → structure → validate → ingest.
3. **Writes** neighborhoods, waypoints, and tasks to a shared Firestore database (named database `urbanexplorer` in GCP project `urban-explorer-483600`).
4. **Serves** both consumer apps; consumers import Zod schemas from `src/schemas/cityAtlas.ts` (copy or git-import — no published npm package).

## Status

Pipeline operational and producing live Firestore data. Extracted from [urban-explorer](https://github.com/Anguijm/urban-explorer) in April 2026 (PR #2). **288-city global registry** (200 US + 88 global; `birmingham-al` duplicate removed 2026-05-01). **257 cities live in `urbanexplorer` Firestore** — 12,123 waypoints, 28,419 tasks, `city_id` backfilled on all serveable tasks (PR #49). Tiered quality gates by `coverageTier` in PR #39; `enrich_ingest.ts` strips undefined fields + Zod-validates before every write (PR #44). Open PR: #49 (timeout scraper disambiguation + backfill script). See `SESSION_HANDOFF.md` for the runbook + `BACKLOG.md` for active priorities.

## Governance

All changes go through the **council** — an 8-persona Gemini review running as a GitHub Actions workflow on every PR (`.github/workflows/council.yml`). Lead Architect synthesis posts as a single re-editable PR comment with 🟢 CLEAR / 🟡 CONDITIONAL / 🔴 BLOCK. Merge requires 🟢, an admin override with filed follow-ups, or `[skip council]` in the PR title (reserved for hotfixes).

See `.harness/README.md` for the protocol, `.harness/council/*.md` for persona definitions, and `CONTRIBUTING.md` for the full workflow.

## Repo layout

```
.github/workflows/       council.yml, pr-watch.yml, ci.yml
.harness/                council personas + scripts + hooks + learnings
configs/
  global_city_cache.json        # 288-city metadata source of truth
  seasonal-calendar.json
  city-sources.json             # per-city URL sources for Gemini/NotebookLM
  atlas-obscura-slugs.json      # city-id → URL slug suffix override (PR #15)
  urban-explorer/tasks.yaml     # UE photo-hunt prompt templates
  roadtripper/tasks.yaml        # RT road-trip prompt templates
src/
  schemas/                      # cross-consumer Zod schemas (cityAtlas.ts); copy or git-import, no npm package
  scrapers/                     # 4 scraper files covering 6 sources (TS)
  pipeline/                     # Phase A/B/C/D orchestration (Python + TS)
  firestore/                    # Admin SDK wrapper
  __tests__/                    # vitest suites
data/                           # scraped .md content (git-tracked)
docs/                           # DATA_COVERAGE_REPORT and other standing docs
```

## Consumers

- [urban-explorer](https://github.com/Anguijm/urban-explorer) — Next.js photo-hunt app, reads cities + neighborhoods + waypoints + tasks (nested under cities, or via `vibe_tasks` flat collection).
- Roadtripper (separate repo) — reads the same shape; per-app filtering lives on individual task docs, not separate collections.

## Open work

Tracked as GitHub issues:

- **#5** — SRE: alert pipe on aggregate `AUDIT_DELETION` waypoint counts (Cloud Logging → BigQuery → Alert Policy)
- **#7** — Phase A scraper prompt-injection defense (Phase B fix in PR #42 pending merge; Phase A scraper wrapping remains)
- **#8** — Sanitize city-ID arguments in `batch_research.py` subprocess calls
- **#9** — Replace personal email with role-based address in scraper User-Agents
- **#12** — CI smoke-test on entry-point scripts (catches the porting-miss class of bugs at port time)
- **#14** — Admin web interface for POI find/add/edit (paste URL or info directly)
- **#17** — Unit tests for `geoBoundsFor` + Infatuation HTML fixtures
- **#21** — Automate branch-guard preflight inside pipeline entry points (defense-in-depth for production writes)
- **#32** — Add Firestore composite indexes when query patterns are implemented
- **#33** — tsconfig: move ESNext+Bundler migration to a dedicated PR
- **#35** — Circuit breaker in `batch_research.py` (25-city safety limit) — implemented in PR #34; issue open as tracking ref
- **#37** — Tiered quality gates by `coverageTier` (village/town/metro) — scraper thresholds, research prompts, QC floor

(#11 closed by PR #15. #10 closed in prior session. #16 + #23 closed by PR #30. #25 closed by PR #27. #36 closed 2026-04-28 after disambiguation audit PASS.)

The pipeline is currently producing data despite all of these — they're improvements, not blockers. Priority guidance lives in `BACKLOG.md` (active) and `SESSION_HANDOFF.md` (start-here block).

## License

See `LICENSE`.
