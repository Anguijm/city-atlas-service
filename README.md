# city-atlas-service

Batch data pipeline that builds the shared city atlas consumed by **Urban Explorer** and **Roadtripper**.

## What it does

1. **Scrapes** seven public sources per city (Atlas Obscura, Spotted by Locals, The Infatuation, TimeOut, Locationscout, Wikipedia, Reddit) into markdown.
2. **Synthesizes** the scraped content through four Gemini-powered phases — research → structure → validate → ingest.
3. **Writes** neighborhoods, waypoints, and per-app tasks to a shared Firestore database (`travel-cities`).
4. **Serves** both consumer apps via the `@travel/city-atlas-types` npm package (Zod schemas + Firestore read helpers).

## Status

Pipeline operational and producing live Firestore data. Extracted from [urban-explorer](https://github.com/Anguijm/urban-explorer) in April 2026 (PR #2). End-to-end validated through real Gemini output on 2026-04-25 — 16 of the 19 originally-parked metro cities now ingested as `source: "enrichment-*"` documents in the `travel-cities` Firestore database; 4 of those 16 are `quality_status: verified` (the first verified data ever produced from this repo). See `SESSION_HANDOFF.md` for the runbook, current known issues, and the roadmap.

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
  urban-explorer/tasks.yaml     # UE photo-hunt prompt templates
  roadtripper/tasks.yaml        # RT road-trip prompt templates
src/
  schemas/                      # published as @travel/city-atlas-types
  scrapers/                     # 7 source-specific scrapers (TS)
  pipeline/                     # Phase A/B/C/D orchestration (Python + TS)
  firestore/                    # Admin SDK wrapper
  __tests__/                    # vitest suites
data/                           # scraped .md content (git-tracked)
docs/                           # DATA_COVERAGE_REPORT and other standing docs
```

## Consumers

- [urban-explorer](https://github.com/Anguijm/urban-explorer) — Next.js photo-hunt app, reads cities + neighborhoods + waypoints + `tasks_ue/*`.
- Roadtripper (separate repo) — reads cities + neighborhoods + waypoints + `tasks_rt/*`.

## Open work

Tracked as GitHub issues:

- **#5** — SRE: alert pipe on aggregate `AUDIT_DELETION` waypoint counts (Cloud Logging → BigQuery → Alert Policy)
- **#6** — Tier-aware deletion floor for small Phase C audit samples
- **#7** — Phase A scraper prompt-injection defense (boundary markers + ignore-instructions guard)
- **#8** — Sanitize city-ID arguments in `batch_research.py` subprocess calls
- **#9** — Replace personal email with role-based address in scraper User-Agents
- **#11** — Scraper refinement: Atlas Obscura URL pattern, The Infatuation finder endpoint, retire Spotted by Locals
- **#12** — CI smoke-test on entry-point scripts (catches the porting-miss class of bugs at port time)

The pipeline is currently producing data despite all of these — they're improvements, not blockers. Priority guidance lives in `SESSION_HANDOFF.md` under the **Roadmap** section.

## License

See `LICENSE`.
