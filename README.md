# city-atlas-service

Batch data pipeline that builds the shared city atlas consumed by **Urban Explorer** and **Roadtripper**.

## What it does

1. **Scrapes** six public sources per city (Atlas Obscura, The Infatuation, TimeOut, Locationscout, Wikipedia, Reddit) into markdown.
2. **Synthesizes** the scraped content through four Gemini-powered phases — research → structure → validate → ingest.
3. **Writes** neighborhoods, waypoints, and tasks to a shared Firestore database (named database `urbanexplorer` in GCP project `urban-explorer-483600`).
4. **Serves** both consumer apps; consumers import Zod schemas from `src/schemas/cityAtlas.ts` (copy or git-import — no published npm package).

## Status

Pipeline operational and producing live Firestore data. Extracted from [urban-explorer](https://github.com/Anguijm/urban-explorer) in April 2026 (PR #2). End-to-end validated through real Gemini output on 2026-04-25 — 15 of the 19 originally-parked metro cities now ingested as `source: "enrichment-*"` documents in the `urbanexplorer` named database; 4 of those 15 are `quality_status: verified` (the first verified data ever produced from this repo). Honolulu pending one-step recovery (16/16); geneva + lisbon are English-source edge cases. Per-source scraper refinement landed in PR #15 (Atlas Obscura overrides, Infatuation finder, Spotted by Locals retired). See `SESSION_HANDOFF.md` for the runbook + `BACKLOG.md` for active priorities.

## Governance

All changes go through the **council** — a 7-persona Gemini review running as a GitHub Actions workflow on every PR (`.github/workflows/council.yml`). Lead Architect synthesis posts as a single re-editable PR comment with 🟢 CLEAR / 🟡 CONDITIONAL / 🔴 BLOCK. Merge requires 🟢, an admin override with filed follow-ups, or `[skip council]` in the PR title (reserved for hotfixes).

See `.harness/README.md` for the protocol, `.harness/council/*.md` for persona definitions, and `CONTRIBUTING.md` for the full workflow.

## Repo layout

```
.github/workflows/       council.yml, pr-watch.yml, ci.yml
.harness/                council personas + scripts + hooks + learnings
configs/
  global_city_cache.json        # 185-city metadata source of truth
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
- **#6** — Tier-aware deletion floor for small Phase C audit samples
- **#7** — Phase A scraper prompt-injection defense (boundary markers + ignore-instructions guard)
- **#8** — Sanitize city-ID arguments in `batch_research.py` subprocess calls
- **#9** — Replace personal email with role-based address in scraper User-Agents
- **#12** — CI smoke-test on entry-point scripts (catches the porting-miss class of bugs at port time)
- **#14** — Admin web interface for POI find/add/edit (paste URL or info directly)
- **#16** — Council infrastructure: pass prior remediations + submitter response into round-N prompt to prevent synthesizer drift
- **#17** — Unit tests for `geoBoundsFor` + Infatuation HTML fixtures

(#11 closed by PR #15. #10 closed in prior session via `f627d83`.)

The pipeline is currently producing data despite all of these — they're improvements, not blockers. Priority guidance lives in `BACKLOG.md` (active) and `SESSION_HANDOFF.md` (start-here block).

## License

See `LICENSE`.
