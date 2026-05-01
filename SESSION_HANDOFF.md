# Session Handoff — city-atlas-service

> Living document. Last refreshed 2026-05-01 (session 5/6 close). Edit in
> place rather than appending date-stamped blocks — this is the "what would
> you want to know on day one" index, not a changelog.
>
> **For session-by-session learnings, see `.harness/learnings.md`** (append-
> only; KEEP / IMPROVE / INSIGHT / COUNCIL blocks per task).
>
> **For active work tracking, see `BACKLOG.md`** at repo root.

## Start here next session

- **`main` HEAD:** `bc6d7a7` (PR #42 — Phase B prompt injection defense + golden-file tests)
- **Last substantive code merge:** `bc6d7a7` (PR #42)
- **In-flight branch:** `fix/backfill-task-city-id-and-orphan-cleanup` (bb0fbb3) — ready for PR. Changes already applied to Firestore.
- **Production state:** 257 legitimate cities in `urbanexplorer` Firestore (260 total minus 3 orphan docs deleted this session). `vibe_tasks` now has `city_id` on 21,368/28,419 tasks; 7,051 remain orphaned (missing neighborhoods). `birmingham-al` duplicate deleted; `birmingham` (Alabama) is authoritative. 8 cities still failing — see Known issues below.
- **Open PRs:** none on main — `fix/backfill-task-city-id-and-orphan-cleanup` branch open, needs PR.
- **Top-priority next actions, in order:**
  1. **Open PR for fix/backfill-task-city-id-and-orphan-cleanup** — `global_city_cache.json` cleanup + backfill script. Already applied to Firestore; PR is documentation + code review gate.
  2. **Fix oxford-ms and birmingham wrong-city scrapes (#47)** — `data/timeout/oxford-ms.md` is Oxford UK; `data/timeout/birmingham.md` is Birmingham UK. Delete both, re-scrape using clinicalName ("Oxford, Mississippi" / "Birmingham, Alabama"), re-run research.
  3. **Supplemental scraping for 24 failed cities** — see BACKLOG.md "Now" section for the full list.
  4. **Issue #21** — automate branch-guard preflight inside pipeline entry points.
  5. **Issue #8** — sanitize city-ID arguments in `batch_research.py`.
- **Blockers:** none.
- **Doctrine reminders:**
  - **All changes to main MUST go through PRs.** Direct push fails branch-guard post-hoc.
  - **Branch-guard preflight before any `--ingest` run:** `gh run list --workflow branch-guard.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion'` → expect `"success"`.
  - **Use `python3.12`**, not `python3` (resolves to 3.14 via linuxbrew, lacks `google-genai`).
  - Database is `urbanexplorer`, NOT `travel-cities`. Schemas at `src/schemas/cityAtlas.ts` (no npm package). Tasks nested under cities + flat in `vibe_tasks`.
  - Cross-round memory is live (PR #30). Post fixed-format submitter response after each council round.
  - `enrich_ingest.ts` now strips undefined fields + validates required fields with Zod before every Firestore write (PR #44).

## 8 cities still failing after enrichment sweep (2026-05-01)

| City | Reason | Fix |
|---|---|---|
| oxford-ms | Semantic audit FAIL: Gemini hallucinated Oxford, UK (timeout scrape pulled UK data) | Delete `data/timeout/oxford-ms.md`, re-scrape, re-run research |
| fernandina-beach-fl | Data starvation — wiki only (1.7KB), no other sources | Manual scrape or add to low-priority queue |
| frederick-md | Data starvation — wiki (3KB) + reddit (3KB) only | Same |
| sitka-ak | Data starvation — wiki (4KB) only | Same |
| winslow-az | Data starvation — wiki (1.4KB) + inf (2KB) only | Same |
| geneva | International — English sources thin | Language-aware Phase A (#future) |
| kaohsiung | International — reddit (5KB) only, no wiki | Same |
| taipei | International — timeout + reddit only, no wiki | Same |

## What this repo is

`city-atlas-service` is the shared data pipeline that scrapes public sources
(Wikipedia, Reddit, Atlas Obscura, The Infatuation, TimeOut, Locationscout),
runs four Gemini phases (research → structure → validate → ingest), and
writes neighborhoods + waypoints + tasks to the `urbanexplorer` named
Firestore database (in GCP project `urban-explorer-483600`) consumed by:

- **[urban-explorer](https://github.com/Anguijm/urban-explorer)** — Next.js
  photo-hunt scavenger app (read-side only).
- **Roadtripper** (separate repo) — road-trip recommendation app.

## What's in main right now

`main` = `7f7652c` at the end of the 2026-05-01 session. Recent history:

```
7f7652c fix: harden enrich_ingest against undefined Firestore fields (#44)
10bd5e1 scrape: Wikipedia + Reddit data for 100 new US cities (#38)
7782539 feat: tiered quality gates by coverageTier (#39)
df1a69b feat: expand US city coverage from 100 to 200 cities (#34)
```

Layout:

```
.github/workflows/
  ci.yml                   # secret-scan + env-example-scrub + validate + city-cache-validate + council-script-check
  council.yml              # 7-persona Gemini review per PR (the audit gate)
  pr-watch.yml             # Claude-powered read-only PR reviewer
  branch-guard.yml         # post-hoc direct-push detector
.harness/
  council/*.md             # 7 personas (architecture, cost, bugs, security,
                           #   product, accessibility, lead-architect)
  scripts/council.py       # runner; calls Gemini 2.5 Pro with diff + personas
  scripts/install_hooks.sh # pre-commit gitleaks
  halt_instructions.md     # how to pause council via .harness_halt
configs/
  global_city_cache.json   # 285-city metadata (source of truth; 200 US, 85 global)
  seasonal-calendar.json   # 6 seasonal events keyed by city
  city-sources.json        # per-city URL sources for NotebookLM/Gemini
  atlas-obscura-slugs.json # city-id → URL slug suffix override (PR #15)
  urban-explorer/tasks.yaml # per-app task-prompt scaffolds (stub)
  roadtripper/tasks.yaml    # per-app task-prompt scaffolds (stub)
src/
  scrapers/
    atlas-obscura.ts       # Playwright (consults configs/atlas-obscura-slugs.json)
    local-sources.ts       # Playwright (handles 3 sources: the-infatuation, timeout, locationscout)
    wikipedia.ts           # fetch + MediaWiki REST API; stateFromId() for US disambiguation
    reddit.ts              # fetch + unauthenticated Reddit JSON
  pipeline/
    README.md              # architecture: Python orchestrates TS
    research_city.py       # Phase A (research) + B (structure) + C (audit)
    phase_c_threshold.py   # proportional FAIL threshold helper (PR #4)
    batch_research.py      # orchestrates research_city.py per-city; 25-city circuit breaker (PR #34)
    build_cache.ts         # Phase D baseline ingest (first-run cities)
    enrich_ingest.ts       # Phase D enrichment (additive, safe)
    qc_cleanup.ts          # duplicate neighborhood dedup
    add_coverage_tiers.py  # tier-assignment helper
    test_phase_c_threshold.py  # 41 pytest cases
  schemas/
    cityAtlas.ts           # Zod schemas — CROSS-CONSUMER CONTRACT
  firestore/
    admin.ts               # Firebase Admin SDK wrapper
  __tests__/               # vitest; Scrapers, Firestore writers, Zod schemas
data/                      # scraped .md + .json content (git-tracked)
firestore.rules            # security rules — deployed from this repo
firestore.indexes.json     # composite indexes — deployed from this repo
requirements.txt           # Python runtime deps
requirements-dev.txt       # Python dev deps (pytest)
```

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
#   FIRESTORE_DATABASE=urbanexplorer

npm install
pip install -r requirements.txt
pip install -r requirements-dev.txt
pip install -r .harness/scripts/requirements.txt

gcloud auth application-default login
```

### Branch-guard preflight (MANDATORY before any --ingest run)

```bash
gh run list --workflow branch-guard.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion'
# Must return: "success"
```

### Research a single city

```bash
python3.12 src/pipeline/research_city.py --city portsmouth-nh --ingest
```

### Batch mode (100 new cities)

```bash
python3.12 src/pipeline/batch_research.py \
  --cities "ann-arbor-mi,annapolis-md,..." \
  --no-limit --ingest --interval 60 \
  2>&1 | tee research-100-new.log
```

### Scrapers

```bash
npx tsx src/scrapers/wikipedia.ts --cities "city1,city2" --interval 1500
npx tsx src/scrapers/reddit.ts --cities "city1,city2" --interval 2000
```

## Known issues / gotchas

1. **Small towns almost universally fail Reddit quality gate.** The gate is calibrated for cities with active subreddits. Issue #37 will add tiered thresholds by `coverageTier`.
2. **Gemini subprocess non-determinism.** `batch_research.py` sometimes produces thinner output than direct `research_city.py` runs. Failed-cities queue + `--force` retry is the compensator.
3. **oxford-ms timeout scrape pulled Oxford, UK data.** Gemini was given a 22KB file about the wrong city and hallucinated accordingly. Semantic audit caught it. Fix: delete the bad file and re-scrape.
4. **Geneva, kaohsiung, taipei, ho-chi-minh-city** — English-only source coverage is thin for non-English-primary cities. Parked pending language-aware Phase A.
5. **London manifest mystery** — in `configs/global_city_cache.json` but absent from `manifest.cities`. Carryover.
6. **CI `city-cache-validate` scope** — the validator in CI only checks `global_city_cache.json`. It does not validate scraped data files or research output JSON.
7. **enrich_ingest.ts undefined field bug (fixed PR #44)** — Gemini occasionally emits `undefined` for optional numeric fields (e.g. `trending_score`). Fix: `stripUndefined()` + Zod required-field validation before every Firestore write.

## Session 2026-05-01 (session 5/6) summary

PRs merged: **#40, #42, #43, #44, #45, #46** — entire PR queue cleared. Firestore audit: confirmed 260 cities in DB (257 legitimate + 3 orphan stubs), debunked assumption that big cities were never researched (they were, first, just without local git artifacts). Ran full `vibe_waypoints` and `vibe_tasks` counts (12,123 waypoints, 28,419 tasks, 1,780 neighborhoods across 260 cities). Backfilled `city_id` onto 21,368 `vibe_tasks` docs via two-pass neighborhood lookup (no AI). Deleted 3 orphan city docs (bellevue, bellevue-wa-usa, new-york) + `birmingham-al` duplicate (154 docs). Removed `birmingham-al` from `global_city_cache.json` (288 entries now). 7,051 orphaned tasks left in place (--delete-orphans available). Branch `fix/backfill-task-city-id-and-orphan-cleanup` ready for PR.

## Session 2026-05-01 (session 4) summary

PRs merged: **#44** (enrich_ingest: stripUndefined + Zod validation, 7 council rounds). Enrichment sweep: 101/119 thin/low cities enriched, ~1800 new waypoints + ~4600 tasks. Roadtripper visibility bug fixed: 23 partial city docs backfilled, city_fallback.json 102→258 cities. 4 corridor cities (louisville, birmingham, wichita, amarillo) added + researched (PR #43 open). 8 cities still failing. Scrape data committed on this branch.

## Session 2026-04-29/30 (session 3) summary

PRs merged: **#38** (scrape data), **#39** (tiered quality gates). Batch run: 173→258 cities ingested (73/97 passed). PR #42 open (CONDITIONAL).

## Session 2026-04-28 summary

PR #34 landed: expanded US city coverage from 100 to 200 cities (285 total globally), added CI `city-cache-validate` job, added `batch_research.py` 25-city circuit breaker. Council took 4 rounds — R4 introduced brand-new disambiguation surface never raised in prior rounds (5/6 personas zero required remediations); admin-override with issue #36 filed. #36 resolved same session after Wikipedia scraper disambiguation audit PASS (8/8 pilot cities correct). Reddit scraper pilot: only Portsmouth, NH passed quality gate — surfaced the need for tiered gates (filed #37). Wikipedia scraped 89/92 new cities; Reddit scrape for 92 cities completed (results TBD at session close). Scrape data committed to `scrape/100-new-cities` branch; PR pending merge.

## Session 2026-04-27 (session 2) summary

PR #26 landed: schema alignment (`cityAtlas.ts` + `build_cache.ts`), CI fixed (tsc clean, Node 22.11.0). Admin-merged after 3 rounds of council drift on the tsconfig surface.

## Session 2026-04-26 (pt3) summary

Parked-metros backlog: 16/16 unparked. Honolulu landed via `enrich_ingest.ts` additive path. PR #27 (branch-guard retry) and PR #28–#31 (session-close docs) merged.

## Roadmap (see BACKLOG.md for ranked list)

- **Immediate:** merge scrape PR, run batch_research for 100 new cities
- **Next:** tiered quality gates (#37), branch-guard preflight automation (#21), city-ID sanitization (#8)
- **Medium:** unit tests (#17), CI smoke-tests (#12), wire `--app` flag, Python integration tests
- **Longer:** Cloud Run + scheduler, Firestore snapshot-before-cycle, incremental queue
- **Bigger:** operator web console (`city-atlas-ops`)

## When you come back to this repo

Cold-start checklist:

1. Read this file top-to-bottom.
2. Read `.harness/learnings.md` — most recent entry is 2026-04-28.
3. Read `CLAUDE.md` for council workflow + Firestore discipline.
4. `git log --oneline -10` for recent commits.
5. `gh pr list` — check if `scrape/100-new-cities` PR is open/merged.
6. `gh run list --workflow branch-guard.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion'` — confirm `"success"` before any ingest run.
7. Top of queue: merge scrape PR, then run batch_research with the 100-city list above.
