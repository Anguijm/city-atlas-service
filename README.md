# city-atlas-service

Batch data pipeline that builds the shared city atlas consumed by **Urban Explorer** and **Roadtripper**.

## What it does

1. **Scrapes** seven public sources per city (Atlas Obscura, Spotted by Locals, The Infatuation, TimeOut, Locationscout, Wikipedia, Reddit) into markdown.
2. **Synthesizes** the scraped content through four Gemini-powered phases — research → structure → validate → ingest.
3. **Writes** neighborhoods, waypoints, and per-app tasks to a shared Firestore database (`travel-cities`).
4. **Serves** both consumer apps via the `@travel/city-atlas-types` npm package (Zod schemas + Firestore read helpers).

## Status

🚧 Fresh spin-off from [urban-explorer](https://github.com/Anguijm/urban-explorer). Pipeline scripts are being ported in. See the plan at `docs/migration.md` (lives in the urban-explorer repo for now).

## Governance

All changes go through the **council** — a 7-persona Gemini review running as a GitHub Actions workflow on every PR (`.github/workflows/council.yml`). Lead Architect synthesis posts as a single PR comment. See `.harness/README.md` for the protocol and `.harness/council/*.md` for persona definitions.

Local development should also call `mcp__gemini__ask-gemini` during iteration, but the PR-time council is the source-of-truth merge gate.

## Repo layout (target state — WIP)

```
.github/workflows/       council.yml, pr-watch.yml, ci.yml
.harness/                council personas + scripts + hooks + evidence
configs/
  global_city_cache.json        # 185-city metadata source of truth
  seasonal-calendar.json
  urban-explorer/tasks.yaml     # UE photo-hunt prompt templates
  roadtripper/tasks.yaml        # RT road-trip prompt templates
src/
  schemas/                      # published as @travel/city-atlas-types
  scrapers/                     # 7 source-specific scrapers
  pipeline/                     # Phase A/B/C/D orchestration
  prompts/                      # research + structuring + validation templates
  firestore/                    # Admin SDK + rules + indexes
cli/                            # batch-research, scrape-{source}, ingest
data/                           # scraped .md content (git-tracked)
```

## Consumers

- [urban-explorer](https://github.com/Anguijm/urban-explorer) — Next.js photo-hunt app, reads cities + neighborhoods + waypoints + `tasks_ue/*`.
- Roadtripper (separate repo) — reads cities + neighborhoods + waypoints + `tasks_rt/*`.

## License

See `LICENSE`.
