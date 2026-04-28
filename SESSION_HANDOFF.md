# Session Handoff — city-atlas-service

> Living document. Last refreshed 2026-04-28 at end-of-session. Edit in
> place rather than appending date-stamped blocks — this is the "what would
> you want to know on day one" index, not a changelog.
>
> **For session-by-session learnings, see `.harness/learnings.md`** (append-
> only; KEEP / IMPROVE / INSIGHT / COUNCIL blocks per task).
>
> **For active work tracking, see `BACKLOG.md`** at repo root.

## Start here next session

- **`main` HEAD:** `df1a69b` (PR #34 — expand US city coverage from 100 to 200 cities; CI city-cache-validate job; batch_research.py circuit breaker)
- **Last substantive code merge:** `df1a69b` (PR #34)
- **Production state:** 16 metro cities live in `urbanexplorer` Firestore (4 verified, 12 degraded). **100 new cities added to config but NOT yet ingested** — scrape data is in-flight (branch `scrape/100-new-cities`).
- **Open PRs:** `scrape/100-new-cities` — Wikipedia (89/92 scraped) + Reddit data for the 100 new cities. Merge this first, confirm branch-guard green, then run batch_research.py.
- **Top-priority next actions, in order:**
  1. **Issue #37 — tiered quality gates by `coverageTier`.** Implement BEFORE running the 100-city research batch. Three-part change: (a) lower Wikipedia/Reddit char floor by coverageTier in `src/scrapers/`, (b) add coverageTier-aware prompt variant in `configs/{app}/tasks.yaml`, (c) scale QC threshold in `phase_c_threshold.py`. `coverageTier` is already in the schema — no schema changes needed.
  2. **Merge `scrape/100-new-cities` PR then run research** (after #37 lands). Pre-flight before the ingest run: (a) `gcloud firestore export gs://urban-explorer-483600.appspot.com/backups/$(date +%Y%m%d)` for rollback, (b) dry run on a 10-city sample without `--ingest` and spot-check the JSON output, (c) confirm branch-guard green. Then: `python3.12 src/pipeline/batch_research.py --cities "<97 city IDs below>" --no-limit --ingest --interval 60 2>&1 | tee research-100-new.log`
  3. **Issue #21 — automate branch-guard preflight inside pipeline entry points.** PR #27's 4-attempt retry pattern is the copy-pasteable template.
  4. **Issue #8 — sanitize city-ID arguments in `batch_research.py` subprocess calls.** One-line allow-list (`^[a-z0-9-]+$`).
- **Blockers:** none. CI validate pre-existing failure on main (npm audit high-severity vuln + rolldown binding) — not introduced by this branch.
- **Doctrine reminders:**
  - **All changes to main MUST go through PRs.** Direct push fails branch-guard post-hoc.
  - **Branch-guard preflight before any `--ingest` run:** `gh run list --workflow branch-guard.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion'` → expect `"success"`.
  - Database is `urbanexplorer`, NOT `travel-cities`. Schemas at `src/schemas/cityAtlas.ts` (no npm package). Tasks nested under cities + flat in `vibe_tasks`.
  - Cross-round memory is live (PR #30). Post fixed-format submitter response after each council round.
  - `batch_research.py` has a 25-city circuit breaker — use `--no-limit` for the 100-city research run.

## The 97 city IDs for batch_research.py

Three cities excluded due to content-thin Wikipedia articles (moab-ut: 325 chars, crested-butte-co: 453 chars, rapid-city-sd: 39 chars). Re-add after issue #37 lowers the quality floor for `coverageTier: village`.

```
ann-arbor-mi,annapolis-md,arcata-ca,asbury-park-nj,ashland-or,astoria-or,bar-harbor-me,beacon-ny,beaufort-sc,bellingham-wa,bethlehem-pa,bisbee-az,black-mountain-nc,boone-nc,bozeman-mt,brattleboro-vt,brevard-nc,camden-me,cannon-beach-or,cape-may-nj,carmel-by-the-sea-ca,charlottesville-va,clarksdale-ms,columbia-sc,cooperstown-ny,deadwood-sd,decatur-ga,durango-co,eau-claire-wi,el-paso-tx,eureka-ca,eureka-springs-ar,fargo-nd,fernandina-beach-fl,florence-al,frederick-md,fredericksburg-tx,galena-il,galveston-tx,gettysburg-pa,gloucester-ma,green-bay-wi,greenville-sc,healdsburg-ca,holland-mi,hood-river-or,hot-springs-ar,hudson-ny,huntsville-al,iowa-city-ia,jerome-az,juneau-ak,kalamazoo-mi,lambertville-nj,lancaster-pa,lawrence-ks,lenox-ma,livingston-mt,lubbock-tx,marquette-mi,monterey-ca,natchez-ms,newport-ri,northampton-ma,ojai-ca,olympia-wa,ouray-co,oxford-ms,pensacola-fl,petaluma-ca,port-townsend-wa,portsmouth-nh,prescott-az,princeton-nj,provincetown-ma,roanoke-va,salem-ma,san-luis-obispo-ca,santa-cruz-ca,saratoga-springs-ny,scottsdale-az,scranton-pa,selma-al,sitka-ak,st-augustine-fl,staunton-va,steamboat-springs-co,stowe-vt,telluride-co,terlingua-tx,truth-or-consequences-nm,waco-tx,whitefish-mt,williamsburg-va,wilmington-nc,winslow-az,woodstock-ny
```

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

`main` = `df1a69b` at the end of the 2026-04-28 session. Recent history:

```
df1a69b feat: expand US city coverage from 100 to 200 cities (#34)
a263c42 docs: README status — note PR #26 schema alignment + CI clean
39ccefb Session close 2026-04-27 (session 2): post-PR-#26 doc refresh
55c8715 schema: align cityAtlas.ts with pipeline-emitted fields (#26)
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

1. **Small towns almost universally fail Reddit quality gate.** Only Portsmouth, NH passed in a 92-city scrape. The gate is calibrated for cities with active subreddits. Issue #37 will add tiered thresholds by `coverageTier`.
2. **Gemini subprocess non-determinism.** `batch_research.py` sometimes produces thinner output than direct `research_city.py` runs. Failed-cities queue + direct retry is the compensator.
3. **Geneva + Lisbon** — English-only source coverage is too thin. Both parked pending language-aware Phase A.
4. **London manifest mystery** — in `configs/global_city_cache.json` but absent from `manifest.cities`. Carryover.
5. **CI `city-cache-validate` scope** — the validator in CI only checks `global_city_cache.json`. It does not validate scraped data files or research output JSON.

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
