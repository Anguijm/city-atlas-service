# Pipeline Architecture

This directory contains the four-phase city research pipeline. It's **one
pipeline with two runtimes** — Python orchestrates, TypeScript does Firestore
I/O. Not two competing implementations.

## Why two languages?

Historical. The research stack started in Python (2026-03) because Gemini's
official SDK and NotebookLM tooling were Python-first, and the scraper stack
started in TypeScript (2026-03) because Playwright has better TS ergonomics
and the original app was Next.js. Rather than rewrite one into the other, we
keep each where it's strongest and let the Python orchestrator drive TS
subprocesses via `npx tsx` for Firestore writes.

## Runtime boundary

```
┌───────────────────────────────────────────────────────────────────────────┐
│  batch_research.py   (Python orchestrator — THE entry point)              │
│    for each pending city in the manifest:                                 │
│      1. call scrape_{source}_if_needed()  → spawns TS scrapers            │
│      2. call research_city.py --city X    → spawns child Python           │
│      3. write manifest status                                             │
└───────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  research_city.py    (Python, per-city pipeline)                          │
│    Phase A (phase_a_gemini)  — reads data/{source}/{city}.md              │
│                                → Gemini 2.5 Pro research report           │
│    Phase B (phase_b_gemini)  — structures report into neighborhoods +     │
│                                waypoints + tasks JSON                     │
│    Phase C (phase_c_validate)— structural floor + Gemini semantic audit   │
│    Phase D (phase_d_ingest)  — spawns `npx tsx src/pipeline/...` to       │
│                                write to Firestore (TS does the Admin SDK) │
└───────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  Firestore writers   (TypeScript)                                         │
│    build_cache.ts    — baseline mode (new cities, `set` with merge)       │
│    enrich_ingest.ts  — additive enrichment (only new docs, never          │
│                        overwrites). Filters on `source: "enrichment-*"`.  │
│    qc_cleanup.ts     — duplicate-neighborhood remapping + soft-delete     │
│    backfill_task_neighborhoods.ts — one-off backfill for legacy tasks     │
└───────────────────────────────────────────────────────────────────────────┘
```

## Why not rewrite one into the other?

- **Python strengths used here:** `google.genai` SDK ergonomics, subprocess
  orchestration with timeouts/manifest checkpoints, textual log output.
- **TypeScript strengths used here:** `firebase-admin` SDK + Zod schemas
  (shared with consumer apps via `@travel/city-atlas-types`), Playwright
  browser automation in scrapers.

A single-language rewrite would require either porting Playwright scrapers
to Python (worse DX, slower) or porting the Gemini/Firestore flow to TS
(doubles our test surface, loses manifest/state simplicity).

## Test coverage map

- **TypeScript layer** (vitest): `build_cache.ts` has 7 test files covering
  city loader, CLI, Firestore writes, generation, indexes, localization,
  validation. Scrapers (`wikipedia.ts`, `reddit.ts`) have dedicated test
  files. See `src/__tests__/`.
- **Python layer:** tests-as-code are minimal today. The Python pipeline is
  exercised end-to-end through live enrichment runs against Firestore, with
  `batch-manifest.json` as the checkpoint ledger. The `phase-a-historical-guard`
  vitest test pins the critical prompt guard by regex-matching the Python
  source. Deeper Python unit testing (mocking Gemini, Firestore) is on the
  roadmap but not required for the extraction to land.

## Running locally

See `../../.env.example` for required env vars. Typical flows:

```bash
# Research a single city end-to-end (all 4 phases + Firestore ingest)
python3.12 src/pipeline/research_city.py --city kyoto --ingest

# Batch resume from manifest at 30-min intervals (production cadence)
python3.12 src/pipeline/batch_research.py --resume --mode gemini --ingest --interval 1800

# Additive enrichment (never overwrites existing Firestore data)
python3.12 src/pipeline/research_city.py --city kyoto --enrich --ingest

# Re-ingest from an existing JSON without re-researching
python3.12 src/pipeline/research_city.py --city kyoto --ingest-only
```

## Ownership

- `research_city.py`, `batch_research.py`, `add_coverage_tiers.py` — Python
  orchestration. Edit these to change phase ordering, manifest semantics,
  or research prompts.
- `build_cache.ts`, `enrich_ingest.ts`, `qc_cleanup.ts`,
  `backfill_task_neighborhoods.ts` — TypeScript Firestore writers. Edit
  these to change what gets written, batch sizes, or Zod validation.
- `src/scrapers/*.ts` — per-source scrapers. Adding a new source =
  new scraper + add to `TEXT_SOURCE_DIRS` in `research_city.py` + add
  to `batch_research.py`'s `scrape_*_if_needed` chain.
