# Session Handoff — 2026-04-23 (city-atlas-service)

> Mirror of `urban-explorer/SESSION_HANDOFF.md`, oriented toward a future
> session that lands in THIS repo first.

## What this repo is

`city-atlas-service` is the shared data pipeline that scrapes public sources
(Wikipedia, Reddit, Atlas Obscura, Spotted by Locals, The Infatuation,
TimeOut, Locationscout), runs four Gemini phases (research → structure →
validate → ingest), and writes neighborhoods + waypoints + tasks to a
Firestore database (`urbanexplorer`, renamed to `travel-cities` in Stage 5)
consumed by:

- **[urban-explorer](https://github.com/Anguijm/urban-explorer)** — Next.js
  photo-hunt scavenger app (read-side only).
- **Roadtripper** (separate repo, user's) — road-trip recommendation app
  (not yet integrated; Stage 4 work).

## This repo was just extracted today

The pipeline has lived inside urban-explorer for months. Today (2026-04-23)
it was moved here. **Don't be confused if urban-explorer still has a copy
of `scripts/`, `data/`, and `src/data/research-output/` — those are
duplicated during the transition and will be deleted from UE in Stage 3.**

## What's in main right now

`main` = `06ecf50` (the merged port PR).

```
.github/workflows/
  ci.yml                   # secret-scan + validate + council-script-check
  council.yml              # 7-persona Gemini review per PR (the audit gate)
  pr-watch.yml             # Claude-powered interactive PR reviewer
.harness/
  council/*.md             # 7 personas (architecture, cost, bugs, security,
                           #   product, accessibility, lead-architect)
  scripts/council.py       # runner; calls Gemini 2.5 Pro with diff + personas
  scripts/install_hooks.sh # pre-commit gitleaks
  halt_instructions.md     # how to pause council via .harness_halt
configs/
  global_city_cache.json   # 185-city metadata (source of truth)
  seasonal-calendar.json   # 6 seasonal events keyed by city
  city-sources.json        # per-city URL sources for NotebookLM/Gemini
src/
  scrapers/
    atlas-obscura.ts       # Playwright
    local-sources.ts       # Playwright (handles 4 source sites)
    wikipedia.ts           # fetch + MediaWiki REST API
    reddit.ts              # fetch + unauthenticated Reddit JSON
  pipeline/
    README.md              # architecture: Python orchestrates TS
    research_city.py       # Phase A (research) + B (structure) + C (audit)
    batch_research.py      # orchestrates research_city.py per-city
    build_cache.ts         # Phase D baseline ingest (first-run cities)
    enrich_ingest.ts       # Phase D enrichment (additive, safe)
    qc_cleanup.ts          # duplicate neighborhood dedup
    add_coverage_tiers.py  # tier-assignment helper
    backfill_task_neighborhoods.ts
  schemas/
    cityAtlas.ts           # Zod schemas — CROSS-CONSUMER CONTRACT
  firestore/
    admin.ts               # Firebase Admin SDK wrapper
  __tests__/               # 11 test files, 111 passing
data/                      # scraped .md + .json content (preserved from UE)
firestore.rules            # security rules — deploy target now this repo
firestore.indexes.json     # composite indexes — deploy target now this repo
```

## Council governance — how this repo does reviews

Every PR auto-triggers `council.yml`. 6 persona reviewers run in parallel
against the PR diff (with `data/**`, lockfiles, and build output excluded),
Lead Architect synthesizes into a single re-editable PR comment with one of:
🟢 CLEAR / 🟡 CONDITIONAL / 🔴 BLOCK. Merge requires 🟢 or admin override.

**Known persona drift to expect:** during the initial port we hit 3 rounds
of BLOCK where `bugs.md` and `product.md` kept referencing pgTAP/Supabase/RLS
despite being rewritten for Firestore context. The personas are loaded
correctly by `council.py`; Gemini just pattern-matches onto StudyGroup-style
CI workflows. **Task #17 in UE's handoff is to tune these personas** — add
explicit guardrails like "this repo uses Firestore with Admin SDK, NOT
Supabase/pgTAP/RLS; `db-tests` is never required."

Diff-size guard: `.harness/scripts/council.py` has a `DIFF_EXCLUDES` list
(landed in commit `02d0d2d`) that strips `data/**`, `package-lock.json`,
minified bundles, and build output from the diff before sending to reviewers.
Overridable via `HARNESS_DIFF_EXCLUDES` env var. Without this, large PRs
blow Gemini's 5M-tokens-per-minute rate limit.

If you absolutely need to skip council for an emergency hotfix, use
`[skip council]` in the PR title (case-insensitive). That's a last-resort
valve, not a default.

## Known issues / gotchas

1. **Gemini subprocess non-determinism.** `batch_research.py` sometimes
   produces thinner output than direct `research_city.py` runs on the same
   city — 3 cities this session failed in batch then succeeded via direct
   retry (knoxville, lexington, worcester). The failed-cities queue + direct
   retry workflow is the compensator. Don't regress it.
2. **5 legitimate coverage failures** from the last UE enrichment run:
   - `fairbanks` — village; augmented wiki should pass on next fresh retry
   - `kahului` — village; only ~3 real POIs within 3km radius (real limit)
   - `marfa` — village; 2K-person town, ~4 real POIs (real limit)
   - `little-rock` — town; 26% waypoint misplacement flagged by Phase C
   - `portland-me` — village; Gemini hallucinated 3 non-existent restaurants
3. **19 parked cities in batch-manifest.json** (`status: "skipped"`,
   `prev_status: "failed"`) from 2026-04-08 — awaiting Phase C proportional
   threshold fix. See UE session memory for list; includes London, Tokyo,
   Rome, Boston, Osaka, Nashville, Denver.
4. **CI gitleaks permission fix** landed in `3dbf171` (before merge to
   main) but the prior failing CI run is still visible in the Actions tab.
   Next CI run on a new PR should pass.
5. **`urbanexplorer` Firestore DB name** is UE-flavored. Stage 5 renames
   it to `travel-cities`. Not urgent.

## How to run the pipeline locally (RUNBOOK)

### One-time setup

```bash
git clone https://github.com/Anguijm/city-atlas-service.git
cd city-atlas-service
cp .env.example .env.local

# Fill in .env.local:
#   GEMINI_API_KEY=<from firebase apphosting:secrets:access or Google AI Studio>
#   GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/application_default_credentials.json
#   GOOGLE_CLOUD_PROJECT=urban-explorer-483600
#   FIRESTORE_DATABASE=urbanexplorer   # (will be travel-cities post Stage 5)

npm install                           # node deps
pip install -r requirements.txt       # python deps
pip install -r .harness/scripts/requirements.txt  # council deps (if you want local council)

gcloud auth application-default login # once, for Firestore Admin SDK
```

### Research a single city

```bash
python3.12 src/pipeline/research_city.py --city akron --ingest
```

Runs Phase A (Gemini research on scraped `data/{source}/akron.md`) → Phase B
(JSON structuring) → Phase C (structural + semantic audit) → Phase D
(Firestore ingest via `npx tsx src/pipeline/build_cache.ts`).

Flags:
- `--mode gemini` (default) / `--mode notebooklm` / `--mode claude`
- `--ingest` writes to Firestore; omit for dry research only
- `--ingest-only` skips A/B/C, just runs Phase D from existing JSON
- `--enrich` additive-only (never overwrites existing data)
- `--structure-only` stops after Phase B
- `--skip-validation` (current default in Phase D call) — debated; see
  DATA_COVERAGE_REPORT.md § 6

### Batch mode (production cadence)

```bash
export GEMINI_API_KEY=$(npx firebase-tools apphosting:secrets:access GEMINI_API_KEY --project urban-explorer-483600 2>/dev/null | tail -1)
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT=urban-explorer-483600

# Resume from manifest at 30-min intervals
tmux new-session -d -s research "python3.12 src/pipeline/batch_research.py --resume --mode gemini --ingest --interval 1800 2>&1 | tee -a research.log"

# Watch progress
tmux attach -t research
# Or from elsewhere:
tail -f research.log | grep -E "Researching|OK|FAILED|Quality"
```

### Scraping (usually auto-triggered by batch_research)

```bash
# Single city, single source
npx tsx src/scrapers/wikipedia.ts --city akron
npx tsx src/scrapers/reddit.ts --city akron

# Whole pending-needs-scraping list
npx tsx src/scrapers/wikipedia.ts --interval 1500
npx tsx src/scrapers/reddit.ts --interval 2000
```

### Operational knobs

Environment overrides:
- `HARNESS_REDDIT_BATCH_CAP=60` — max Reddit scrapes per batch run
- `HARNESS_DIFF_EXCLUDES="p1,p2"` — extend council diff-exclude list
- `HARNESS_MODEL=gemini-2.5-pro` — council model override
- `PIPELINE_SUBPROCESS_TIMEOUT=3600` — per-city subprocess timeout (sec)

Circuit breaker:
```bash
echo "Halting: prompt regression under investigation" > .harness_halt
```
Council + pr-watch silently no-op until the file is removed.

## What's next for this repo

Sorted by return vs risk, same priorities as UE's handoff:

### Short ~30 min each
- **Persona tuning** — add "this is Firestore, not Supabase" guardrails to
  `bugs.md` + `security.md` to stop pgTAP drift. Test with a small dogfood
  PR (e.g., touch a config comment) — council should NOT flag db-tests.
- **CI gitleaks perm** — already landed in `3dbf171`. Verify next CI run
  passes.

### Medium ~2 hrs each
- **Stage 1: publish `@travel/city-atlas-types`** — extract
  `src/schemas/cityAtlas.ts` + the readers/transformers still living in
  urban-explorer's `src/lib/`. Publish to GitHub Packages. Both consumer
  apps depend on it.
- **Wire `--app {ue|roadtripper}` flag** — the plan's per-consumer task
  template split. Create `configs/urban-explorer/tasks.yaml` (lift current
  photo-hunt prompts verbatim) + `configs/roadtripper/tasks.yaml` (stub).
  Add `--app` to `batch_research.py` + `research_city.py` that selects the
  config and writes to `tasks_ue/*` or `tasks_rt/*` collection. Council
  will likely BLOCK first round — normal.
- **Python unit tests** — mock Gemini + Firestore, unit-test
  `phase_a_gemini`, `phase_b_gemini`, `phase_c_validate`. Deferred during
  the port; worth landing before any real prompt change.

### Longer ~half day each
- **Cloud Run + Cloud Scheduler host** — replace tmux with a scheduled
  job. `Dockerfile` at repo root, `gcloud run deploy` + scheduler trigger
  at 30-min cadence. Auto-pauses when there's nothing pending. Stops being
  tied to any one machine's tmux.
- **Firestore snapshot-before-cycle** — `gcloud firestore export` before
  each enrichment cycle; auto-prune exports >30 days old. Rollback is then
  one command.
- **Incremental queue** — replace whole-batch model with a priority queue
  reading `pending_research` Firestore collection (demand-weighted).
  Hot cities re-enriched daily, cold monthly.

### Bigger ~multi-day / new surface
- **Operator web console (`city-atlas-ops`)** — a browser UI for running
  and curating the pipeline. Pairs well with Cloud Run + the incremental
  queue above (that's the backend; this is the UX). Minimum viable scope:
  - **Run control:** start/stop a batch (resume from manifest, target
    subset, toggle `--mode gemini|notebooklm|claude`, toggle `--enrich`),
    live log tail, halt (touches `.harness_halt`), cost budget readout.
  - **Backlog triage:** list failed/parked cities with the Phase C reason,
    one-click direct retry (bypassing the batch subprocess for the known
    non-determinism gap), manifest state view + edits.
  - **Data editor:** browse/edit `cities/*`, `neighborhoods/*`, `waypoints/*`
    docs for a city — fix neighborhood assignments, drop hallucinated
    waypoints by hand, re-tier a city (metro/town/village). Writes must
    flow through an allow-listed mutation layer, NOT raw Admin SDK, so the
    `saved_hunts`/`cache_locks` carve-outs stay intact.
  - **Quality readouts:** Phase C PASS/WARNING/FAIL rates per source, tier,
    and batch; per-source accept/reject scoring (ties to the "per-source
    quality scoring" experimental item below).
  - **Access control:** Firebase Auth with an allow-listed admin email
    list; every mutation tagged with operator + timestamp in an audit
    collection (`ops_audit/*`).
  - **Stack hint:** Next.js app colocated in a new `ops/` folder or a
    sibling repo `city-atlas-ops`; reads via Firebase client SDK with
    admin-scoped rules; mutations call Cloud Run endpoints in this repo
    (keeps the Admin SDK server-side only). Start with the Run control
    surface — highest utility, smallest blast radius.

### Experimental / exploratory
- New scraper sources: Tripadvisor, Yelp Fusion API, Google Places reviews,
  TikTok food videos.
- Per-source quality scoring (accept/reject rate per source).
- GraphQL or REST gateway in front of Firestore for consumer apps.

## Recommended next-session order (in this repo)

1. **Persona tuning** to stop pgTAP drift (20 min). Removes the biggest
   recurring friction from future council rounds.
2. **Phase C proportional threshold** — note: may already be DONE in
   urban-explorer. Check `scripts/phase_c_threshold.py` in UE's latest
   commit `d15865a` or later; if so, port here. Unparks the 19 stuck
   cities once we run a batch from this repo.
3. **First production pipeline run from this repo.** Ideally on the
   19-city unpark set. Validates end-to-end extraction.
4. **Stage 1: types package extraction.** Biggest architectural unlock;
   required for Roadtripper integration.
5. **Stage 3: UE cleanup.** Only after #3 proves the new repo runs
   production-equivalent batches cleanly.

## Cross-references

- **UE handoff doc:** `urban-explorer/SESSION_HANDOFF.md` — mirror of this,
  UE-side.
- **Migration plan:** lives locally at
  `/home/johnanguiano/.claude/plans/i-think-we-need-soft-salamander.md`
  (approved 2026-04-23).
- **Data coverage report:** `docs/DATA_COVERAGE_REPORT.md` (ported from UE).

## When you come back to this repo

1. Read this file.
2. Read `CLAUDE.md` for protocol (Bedrock rules, council workflow).
3. Read `src/pipeline/README.md` for how the Python + TypeScript layers
   fit together.
4. `git log --oneline -10` to see recent commits.
5. `gh pr list --repo Anguijm/city-atlas-service` for any open PRs.
6. If running locally: follow the RUNBOOK above.
7. If debugging council: check `.harness/last_council.md` for the most
   recent synthesis output (local dev only).
