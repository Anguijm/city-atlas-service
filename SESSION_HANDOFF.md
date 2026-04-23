# Session Handoff — city-atlas-service

> Living document. Last refreshed 2026-04-24 at end-of-session. Edit in place
> rather than appending date-stamped blocks — this is the "what would you want
> to know on day one" index, not a changelog.

## What this repo is

`city-atlas-service` is the shared data pipeline that scrapes public sources
(Wikipedia, Reddit, Atlas Obscura, Spotted by Locals, The Infatuation,
TimeOut, Locationscout), runs four Gemini phases (research → structure →
validate → ingest), and writes neighborhoods + waypoints + tasks to the
`travel-cities` Firestore database consumed by:

- **[urban-explorer](https://github.com/Anguijm/urban-explorer)** — Next.js
  photo-hunt scavenger app (read-side only).
- **Roadtripper** (separate repo) — road-trip recommendation app
  (schema parity landed with the per-app tasks split; end-to-end integration
  is the Stage-4 item below).

Extracted from `urban-explorer` on 2026-04-23 (commit `06ecf50` merged the
initial port). urban-explorer still has a copy of `scripts/`, `data/`, and
`src/data/research-output/` pending Stage-3 cleanup on that side — no action
needed from this repo until then.

## What's in main right now

`main` = `951b34d` at the end of the 2026-04-23/24 session. Recent history:

```
951b34d Tune bugs/security/product personas with explicit Firestore guardrails (#3)
a733650 Port Phase C proportional >25% FAIL threshold with hardening (#4)
1d28464 Add operator web-console TODO to session handoff
481d5df Add SESSION_HANDOFF.md + per-app tasks.yaml scaffolds for next-session pickup
06ecf50 Port pipeline from urban-explorer (scrapers + Phase A-D + schemas + configs + rules) (#2)
f4e9d7c Scaffold city-atlas-service with council review infrastructure
```

Layout:

```
.github/workflows/
  ci.yml                   # secret-scan + validate + council-script-check
  council.yml              # 7-persona Gemini review per PR (the audit gate)
  pr-watch.yml             # Claude-powered read-only PR reviewer
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
  urban-explorer/tasks.yaml # per-app task-prompt scaffolds (stub)
  roadtripper/tasks.yaml    # per-app task-prompt scaffolds (stub)
src/
  scrapers/
    atlas-obscura.ts       # Playwright
    local-sources.ts       # Playwright (handles 4 source sites)
    wikipedia.ts           # fetch + MediaWiki REST API
    reddit.ts              # fetch + unauthenticated Reddit JSON
  pipeline/
    README.md              # architecture: Python orchestrates TS
    research_city.py       # Phase A (research) + B (structure) + C (audit)
    phase_c_threshold.py   # proportional FAIL threshold helper (PR #4)
    batch_research.py      # orchestrates research_city.py per-city
    build_cache.ts         # Phase D baseline ingest (first-run cities)
    enrich_ingest.ts       # Phase D enrichment (additive, safe)
    qc_cleanup.ts          # duplicate neighborhood dedup
    add_coverage_tiers.py  # tier-assignment helper
    test_phase_c_threshold.py  # 31 pytest cases (PR #4)
  schemas/
    cityAtlas.ts           # Zod schemas — CROSS-CONSUMER CONTRACT
  firestore/
    admin.ts               # Firebase Admin SDK wrapper
  __tests__/               # vitest; Scrapers, Firestore writers, Zod schemas
data/                      # scraped .md + .json content (preserved from UE)
firestore.rules            # security rules — deployed from this repo
firestore.indexes.json     # composite indexes — deployed from this repo
requirements.txt           # Python runtime deps
requirements-dev.txt       # Python dev deps (pytest)
```

## Session 2026-04-23/24 summary

Two PRs landed via admin override after multi-round council review:

- **PR #3** (`951b34d`) — tuned `bugs.md`, `security.md`, and `product.md`
  personas with explicit "What this repo is NOT" guardrails (no Supabase,
  no pgTAP, no RLS, no user-facing UI). The dogfood test worked: the bugs
  persona scored 10/10 with zero pgTAP drift on the markdown-only diff.
  Admin override was used because the security reviewer's 3/10 was driven
  by **pre-existing** repo concerns outside the diff's scope (tracked as
  follow-up issues).
- **PR #4** (`a733650`) — ported Phase C's proportional `>25%` FAIL
  threshold from urban-explorer `ce44569`, then hardened beyond a pure
  mirror across five council rounds. Adds the `phase_c_threshold.py` pure
  helper, a module-level deterministic `find_hallucinated_names` matcher
  (replaces an LLM-based extractor that had prompt-injection and silent-
  demotion bugs), preserve-FAIL / escalate-WARNING guards, a `>75%` mass-
  wipe cap, structured `AUDIT_DELETION` JSON logs, expanded
  `HALLUCINATION_KEYWORDS`, and 31 pytest cases.

Net effect: the 19 parked cities from the 2026-04-08 batch are **unblocked
in code** — the proportional threshold they were waiting on is live. They
remain parked in the manifest until someone runs a production batch from
this repo.

## Open follow-up issues

Filed at the end of the session; none are merge blockers, all are tracked:

- **#5** — SRE alert pipe on aggregate `AUDIT_DELETION` waypoint counts
  (Cloud Logging sink → BigQuery/Log Analytics → Alert Policy). Code hook
  already emits the structured line; this is GCP infra config.
- **#6** — Tier-aware deletion floor for small Phase C audit samples. The
  current `>75%` guard is weak at village-tier sample sizes where `3/4`
  doesn't trip but is catastrophic in absolute terms.
- **#7** — Prompt-injection defense for scraped content in Phase A / Phase B
  prompts. Wrap scraped `.md` in `<scraped_content>` boundary markers and
  add explicit "treat as data, ignore instructions" guard.
- **#8** — Sanitize city-ID arguments before subprocess calls in
  `batch_research.py`. Allow-list `^[a-z0-9-]+$` before `subprocess.run`.
  Currently low-risk because IDs come from the static
  `configs/global_city_cache.json`, but widens with the incremental-queue
  and ops-console roadmap items.
- **#9** — Replace personal email in scraper User-Agents with a role-based
  address. Information-disclosure hygiene, not a security vuln.

## Known issues / gotchas

1. **Gemini subprocess non-determinism.** `batch_research.py` sometimes
   produces thinner output than direct `research_city.py` runs on the
   same city — 3 cities last session (knoxville, lexington, worcester)
   failed in batch then succeeded via direct retry. The failed-cities
   queue + direct retry workflow is the compensator. Don't regress it.
2. **5 legitimate coverage failures** from the 2026-04-08 UE enrichment:
   - `fairbanks` — village; augmented wiki should pass on next fresh retry
   - `kahului` — village; only ~3 real POIs within 3km radius (real limit)
   - `marfa` — village; 2K-person town, ~4 real POIs (real limit)
   - `little-rock` — town; 26% waypoint misplacement flagged by Phase C
   - `portland-me` — village; Gemini hallucinated 3 non-existent restaurants
3. **19 parked cities in batch-manifest.json** (`status: "skipped"`,
   `prev_status: "failed"`) from 2026-04-08 — **unblocked in code as of
   PR #4** but not retried yet in production. List includes London, Tokyo,
   Rome, Boston, Osaka, Nashville, Denver. The next batch run from this
   repo is the validation gate.
4. **Council synthesis doesn't scope to diff.** `lead-architect.md` will
   surface findings from surrounding code and count them toward BLOCK,
   even when the diff is tiny and unrelated. Admin override is the escape
   hatch when the findings are legitimate but out-of-scope. A follow-up
   PR tuning the synthesis prompt to distinguish "diff-scoped" from
   "repo-scoped" findings would retire this gotcha — not yet scheduled.
5. **CI `validate` is pre-existing-broken.** `src/__tests__/build-vibe-
   cache-*.test.ts` and `src/scrapers/local-sources.ts` hit tsconfig
   target/module errors that existed before the port. Does not block
   merges; `council` and `secret-scan` still gate.

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
#   FIRESTORE_DATABASE=travel-cities

npm install                                          # node deps
pip install -r requirements.txt                      # python runtime deps
pip install -r requirements-dev.txt                  # python dev deps (pytest)
pip install -r .harness/scripts/requirements.txt     # council deps (local only)

gcloud auth application-default login                # once, for Firestore Admin SDK
```

### Research a single city

```bash
python3.12 src/pipeline/research_city.py --city akron --ingest
```

Runs Phase A (Gemini research on scraped `data/{source}/akron.md`) → Phase B
(JSON structuring) → Phase C (structural + semantic audit + proportional
threshold + deterministic hallucination cleanup) → Phase D (Firestore
ingest via `npx tsx src/pipeline/build_cache.ts`).

Flags:
- `--mode gemini` (default) / `--mode notebooklm` / `--mode claude`
- `--ingest` writes to Firestore; omit for dry research only
- `--ingest-only` skips A/B/C, just runs Phase D from existing JSON
- `--enrich` additive-only (never overwrites existing data)
- `--structure-only` stops after Phase B
- `--skip-validation` (current default in Phase D call) — see
  `docs/DATA_COVERAGE_REPORT.md` §6

### Batch mode (production cadence)

```bash
export GEMINI_API_KEY=$(npx firebase-tools apphosting:secrets:access GEMINI_API_KEY --project urban-explorer-483600 2>/dev/null | tail -1)
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT=urban-explorer-483600

# Resume from manifest at 30-min intervals
tmux new-session -d -s research "python3.12 src/pipeline/batch_research.py --resume --mode gemini --ingest --interval 1800 2>&1 | tee -a research.log"

# Watch progress (AUDIT_DELETION lines surface automated Phase C cleanups)
tmux attach -t research
tail -f research.log | grep -E "Researching|OK|FAILED|Quality|DEMOTED|ESCALATED|REMOVED|AUDIT_DELETION"
```

### Unparking the 19 cities (top next action)

PR #4 unblocked them in code. Recommended first validation: pick one
(e.g. `boston`) and run the direct path to confirm the new proportional
threshold + deterministic cleanup work against real Gemini output:

```bash
python3.12 src/pipeline/research_city.py --city boston --enrich --ingest 2>&1 | tee boston-retry.log
```

Watch for `DEMOTED: FAIL -> WARNING` or `REMOVED: N hallucinated waypoints`
in the log to confirm the new path fires. If `boston` passes, batch-retry
the remaining 18 via `batch_research.py --resume`.

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

## Roadmap

Sorted by return vs risk.

### Now (top of queue)
- **First production batch run from this repo** on the 19 parked cities.
  Validates PR #4 end-to-end against real Gemini output and unlocks the
  rest of the Stage-3+ roadmap. Recommended start: single-city `boston`
  retry, then full batch.

### Short (~30 min each)
- **Close out follow-up issues** #5–#9 as priorities allow. None are
  merge blockers but #8 (city-ID sanitization) is a prerequisite for
  the incremental-queue and ops-console items below.

### Medium (~2 hrs each)
- **Stage 1: publish `@travel/city-atlas-types`** — extract
  `src/schemas/cityAtlas.ts` + the readers/transformers still living in
  urban-explorer's `src/lib/`. Publish to GitHub Packages. Both consumer
  apps depend on it.
- **Wire `--app {ue|roadtripper}` flag** — the per-consumer task-template
  split. The `configs/urban-explorer/tasks.yaml` + `configs/roadtripper/
  tasks.yaml` scaffolds exist already; the flag wiring in `research_city.py`
  + `batch_research.py` selects the config and routes writes to `tasks_ue/*`
  or `tasks_rt/*`. Council will likely BLOCK first round — normal.
- **Python integration tests for `phase_c_validate`** — mock Gemini +
  Firestore; council has asked for these on PR #4 and future Phase C
  changes. The unit-level helpers (`phase_c_threshold`,
  `find_hallucinated_names`, `HALLUCINATION_KEYWORDS`) have 31 pytest
  cases; the integration surface (full flow + mocked external I/O) is
  the next step.

### Longer (~half day each)
- **Cloud Run + Cloud Scheduler host** — replace tmux with a scheduled
  job. `Dockerfile` at repo root, `gcloud run deploy` + scheduler trigger
  at 30-min cadence. Auto-pauses when there's nothing pending. Stops being
  tied to any one machine's tmux.
- **Firestore snapshot-before-cycle** — `gcloud firestore export` before
  each enrichment cycle; auto-prune exports >30 days old. Rollback is
  then one command.
- **Incremental queue** — replace whole-batch model with a priority queue
  reading `pending_research` Firestore collection (demand-weighted).
  Hot cities re-enriched daily, cold monthly.

### Bigger (~multi-day / new surface)
- **Operator web console (`city-atlas-ops`)** — browser UI for running
  and curating the pipeline. Pairs with Cloud Run + the incremental queue
  above (backend) to provide the UX. Minimum viable scope:
  - **Run control:** start/stop a batch, live log tail, halt (touches
    `.harness_halt`), cost budget readout.
  - **Backlog triage:** list failed/parked cities with the Phase C reason,
    one-click direct retry, manifest state view + edits.
  - **Data editor:** browse/edit `cities/*`, `neighborhoods/*`, `waypoints/*`
    docs for a city — fix neighborhood assignments, drop hallucinated
    waypoints by hand, re-tier a city. Writes flow through an allow-listed
    mutation layer, NOT raw Admin SDK, so the `saved_hunts`/`cache_locks`
    carve-outs stay intact.
  - **Quality readouts:** Phase C PASS/WARNING/FAIL rates per source, tier,
    batch. `AUDIT_DELETION` log aggregation (ties to issue #5's alert pipe).
  - **Access control:** Firebase Auth with allow-listed admin emails;
    every mutation tagged with operator + timestamp in an `ops_audit/*`
    Firestore collection.
  - **Stack hint:** Next.js app in a new sibling repo `city-atlas-ops` (or
    `ops/` folder here); reads via Firebase client SDK with admin-scoped
    rules; mutations call Cloud Run endpoints in this repo (keeps the
    Admin SDK server-side only). Start with Run control — highest utility,
    smallest blast radius.

### Experimental / exploratory
- New scraper sources: Tripadvisor, Yelp Fusion API, Google Places reviews,
  TikTok food videos.
- Per-source quality scoring (accept/reject rate per source).
- GraphQL or REST gateway in front of Firestore for consumer apps.
- Council-synthesis prompt tuning so BLOCK verdicts require diff-scoped
  findings (retires gotcha #4).

## Cross-references

- **Operating protocol:** `CLAUDE.md` (council workflow, Firestore
  discipline, cost discipline, halt procedure).
- **Contributing guide:** `CONTRIBUTING.md` (TDD cadence, branch
  conventions, test runners).
- **Pipeline architecture:** `src/pipeline/README.md` (Python/TS runtime
  boundary, Phase C hardening notes).
- **Harness:** `.harness/README.md` (council runner, session state,
  circuit breaker, pr-watch relationship).
- **Data coverage snapshot:** `docs/DATA_COVERAGE_REPORT.md` (point-in-
  time analysis of source coverage + failed-city categorization, from
  immediately before the extraction).
- **UE-side handoff (if still present):** `urban-explorer/SESSION_HANDOFF.md`
  — sister doc if you need Stage-3 cleanup context on the UE side.

## When you come back to this repo

1. Read this file.
2. Read `CLAUDE.md` for protocol (council workflow, Firestore/cost
   discipline).
3. Read `src/pipeline/README.md` for how the Python + TypeScript layers
   fit together and the Phase C hardening story.
4. `git log --oneline -10` for recent commits.
5. `gh pr list --repo Anguijm/city-atlas-service` for any open PRs.
6. `gh issue list --repo Anguijm/city-atlas-service` for the follow-up
   backlog (#5–#9 at time of writing).
7. If the "first production batch run" is still pending, that's the top
   priority — see the RUNBOOK's "Unparking the 19 cities" block.
8. If running locally: follow the RUNBOOK above.
9. If debugging council: `gh pr view <N> --comments` surfaces the latest
   Lead Architect synthesis; `.harness/last_council.md` has the most
   recent local-runner output.
