# city-atlas-service

Batch data pipeline that builds the shared city atlas consumed by **Urban Explorer** and **Roadtripper**.

## What it does

1. **Scrapes** seven public sources per city (Atlas Obscura, Spotted by Locals, The Infatuation, TimeOut, Locationscout, Wikipedia, Reddit) into markdown.
2. **Synthesizes** the scraped content through four Gemini-powered phases — research → structure → validate → ingest.
3. **Writes** neighborhoods, waypoints, and per-app tasks to a shared Firestore database (`travel-cities`).
4. **Serves** both consumer apps via the `@travel/city-atlas-types` npm package (Zod schemas + Firestore read helpers).

## Status

Pipeline operational. Extracted from [urban-explorer](https://github.com/Anguijm/urban-explorer) in April 2026 (merged via PR #2). The four Gemini phases (research → structure → validate → ingest) run end-to-end against the shared Firestore database. See `SESSION_HANDOFF.md` for the runbook, current known issues, and the roadmap.

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

## License

See `LICENSE`.
