# Session Handoff — city-atlas-service

> Living document. Last refreshed 2026-05-11 (session 8 close). Edit in
> place rather than appending date-stamped blocks — this is the "what would
> you want to know on day one" index, not a changelog.
>
> **For session-by-session learnings, see `.harness/learnings.md`** (append-
> only; KEEP / IMPROVE / INSIGHT / COUNCIL blocks per task).
>
> **For active work tracking, see `BACKLOG.md`** at repo root.

## Start here next session

- **`main` HEAD:** `e069e1d` (PR #53 — CLAUDE.md TypeScript config section)
- **Last substantive code merge:** `db251ec` (PR #51 — city-ID validation + branch-guard preflight)
- **Open PRs:**
  - **PR #56** (`fix/npm-audit-transitive-vulns`) — npm overrides for @tootallnate/once + fast-xml-builder; council R3 queued after R2 uuid-override fix. Closes #55.
  - **PR #57** (`fix/pipeline-utils-check-branch-guard`) — `pipeline_utils.py` shared module, fail-closed `check_branch_guard()`, 18 pytest tests; council R3 queued after R2 comment additions. Closes #54.
- **Production state:** 277/288 cities live in `urbanexplorer` Firestore (14,975+ waypoints, 34,400+ tasks). 11 permanently-thin US tier3 cities blocked on data sources.
- **Top-priority next actions, in order:**
  1. **Check council on PR #56 and PR #57** — both awaiting R3. Address any new remediations; admin-override if OOS drift.
  2. **Issue #6 — tier-aware Phase C deletion floor.** Next in the queue after #54/#55.
  3. **Issue #12 — CI smoke-test on entry-point scripts.**
  4. **11 thin cities** — unblocked only by new data sources (TripAdvisor, AllTrails, tourism boards).
- **Blockers:** none.
- **Doctrine reminders:**
  - **All changes to main MUST go through PRs.** Direct push fails branch-guard post-hoc.
  - **`check_branch_guard()` is now fail-closed** (PR #57, pending merge). Until merged, `batch_research.py` / `research_city.py` still have the old fail-open version.
  - **Use `python3.12`**, not `python3` (resolves to 3.14 via linuxbrew, lacks `google-genai`).
  - Database is `urbanexplorer`, NOT `travel-cities`. Schemas at `src/schemas/cityAtlas.ts` (no npm package).
  - Cross-round memory is live (PR #30). Post fixed-format submitter response after each council round.
  - Monthly council budget is 120 calls (raised from 60 in PR #51).

## 11 permanently-thin cities (blocked on data sources)

| City | Reason |
|---|---|
| `black-mountain-nc`, `camden-me`, `cannon-beach-or`, `crested-butte-co` | Atlas Obscura + Wikipedia → <6 wp consistently |
| `kahului`, `lambertville-nj`, `lenox-ma`, `moab-ut` | Same — outdoor/rural destination thin on structured POI data |
| `ouray-co`, `stowe-vt`, `telluride-co` | Same |

Fix requires a new source: TripAdvisor scraper, AllTrails integration, local tourism boards, or manual POI entry (#14).

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

`main` = `e069e1d` (session 8 close). Recent history:

```
e069e1d docs(tsconfig): CLAUDE.md TypeScript config section (PR #53, closes #33)
db251ec fix: city-ID validation + branch-guard preflight + budget 60→120 (PR #51, closes #8, #21)
c8c901e fix: city_id backfill, birmingham-al rename, scraper disambiguation (PR #49)
94c2955 docs: session 5 close (PR #48)
bc6d7a7 fix: Phase B prompt injection defense (PR #42)
```

Layout:

```
.github/workflows/
  ci.yml                   # secret-scan + env-example-scrub + validate + city-cache-validate + council-script-check
  council.yml              # 7-persona Gemini review per PR (120-call monthly budget)
  pr-watch.yml             # Claude-powered read-only PR reviewer
  branch-guard.yml         # post-hoc direct-push detector
.harness/
  council/*.md             # 7 personas (architecture, cost, bugs, security,
                           #   product, accessibility, lead-architect)
  scripts/council.py       # runner; calls Gemini 2.5 Pro with diff + personas
  scripts/install_hooks.sh # pre-commit gitleaks
configs/
  global_city_cache.json   # 288-city metadata (source of truth)
  seasonal-calendar.json   # 6 seasonal events keyed by city
  city-sources.json        # per-city URL sources for NotebookLM/Gemini
  atlas-obscura-slugs.json # city-id → URL slug suffix override
src/
  scrapers/
    atlas-obscura.ts       # Playwright; --city only (no --cities plural)
    local-sources.ts       # Playwright; 3 sources: the-infatuation, timeout, locationscout
    wikipedia.ts           # fetch + MediaWiki REST API; stateFromId() for US disambiguation
    reddit.ts              # fetch + unauthenticated Reddit JSON; --cities comma-separated
  pipeline/
    README.md              # architecture: Python orchestrates TS
    research_city.py       # Phase A (research) + B (structure) + C (audit)
    phase_c_threshold.py   # proportional FAIL threshold helper
    batch_research.py      # orchestrates research_city.py per-city; 25-city circuit breaker
    pipeline_utils.py      # shared: CITY_ID_RE, check_branch_guard() — PENDING PR #57
    build_cache.ts         # Phase D baseline ingest (first-run cities)
    enrich_ingest.ts       # Phase D enrichment (additive, safe)
    qc_cleanup.ts          # duplicate neighborhood dedup
    test_phase_c_threshold.py  # 68 pytest cases
    test_pipeline_utils.py     # 18 pytest cases — PENDING PR #57
  schemas/
    cityAtlas.ts           # Zod schemas — CROSS-CONSUMER CONTRACT
  firestore/
    admin.ts               # Firebase Admin SDK wrapper
  __tests__/               # vitest; Scrapers, Firestore writers, Zod schemas
data/                      # scraped .md + .json content (git-tracked)
firestore.rules            # security rules
firestore.indexes.json     # composite indexes
```

## How to run the pipeline locally (RUNBOOK)

### One-time setup

```bash
git clone https://github.com/Anguijm/city-atlas-service.git
cd city-atlas-service
cp .env.example .env.local
# Fill in: GEMINI_API_KEY, GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_PROJECT, FIRESTORE_DATABASE

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
# Note: after PR #57 merges, batch_research.py and research_city.py run this automatically
```

### Research a single city

```bash
python3.12 src/pipeline/research_city.py --city portsmouth-nh --ingest
```

### Batch mode

```bash
python3.12 src/pipeline/batch_research.py \
  --cities "city1,city2,city3" \
  --no-limit --ingest --interval 60 \
  2>&1 | tee batch.log
```

### Scrapers

```bash
npx tsx src/scrapers/wikipedia.ts --cities "city1,city2" --interval 1500
npx tsx src/scrapers/reddit.ts --cities "city1,city2" --interval 2000
# Atlas Obscura: --city only (singular); loop for multiple:
for city in city1 city2 city3; do
  npx tsx src/scrapers/atlas-obscura.ts --city $city
done
```

## Known issues / gotchas

1. **check_branch_guard() is fail-closed after PR #57 merges.** Until then, the current main version is fail-open on gh errors. Don't rely on it for safety guarantees until the PR merges.
2. **atlas-obscura.ts has no `--cities` (plural) flag.** Use `--city` in a loop. (#improve)
3. **npm audit has a moderate uuid vulnerability** (GHSA-w5hq-g745-h8pq) — not fixed because a top-level override forces ^8/^9 packages to use uuid 11.x. Moderate severity; doesn't block CI at `--audit-level=high`.
4. **4 Vitest tests fail on main** — `city-coverage-tier.test.ts` fixtures haven't kept up with the 288-city list. Pre-existing; doesn't block shipping.
5. **London manifest mystery** — in `global_city_cache.json` but absent from `manifest.cities`. Carryover.
6. **Geneva, kaohsiung, taipei** — English-only source coverage thin; need language-aware Phase A.

## Session 2026-05-10/11 (session 8) summary

**Focus:** maintenance PRs — close the two issues filed in session 7 and knock out issue #33 (tsconfig docs).

**Merged:**
- PR #53 — CLAUDE.md TypeScript configuration section (closes #33). 🟢 CLEAR R1 (doc-only). `e069e1d`.

**Opened:**
- Issue #54 — `check_branch_guard` CalledProcessError gap + dedup ask
- Issue #55 — npm audit HIGH vulns via firebase-admin transitive deps
- PR #56 — npm audit fix (`@tootallnate/once 3.0.1`, `fast-xml-builder 1.2.0` via overrides). Council R1 🔴 (floating versions + no docs) → R2 🔴 (uuid 11.1.1 "invalid" — moderate, dropped from overrides). R3 queued.
- PR #57 — `pipeline_utils.py` shared module + fail-closed `check_branch_guard()` + 18 tests. Council R1 🔴 (fail-open → fail-closed) → R2 🟡 (3 comment additions). R3 queued.

**Key decisions:**
- `check_branch_guard` is now fail-closed in PR #57: ANY inability to get a "success" verdict aborts the pipeline. Previous fail-open was inconsistent with the stated blast-radius reasoning.
- uuid moderate override dropped: forcing ^8/^9 packages to use uuid 11.x violates their semver ranges; moderate severity doesn't trigger `--audit-level=high`.

## Session 2026-05-07 (session 7) summary

PR #51 merged: city-ID validation + `check_branch_guard()` in both entry points + monthly budget 60→120 + BACKLOG update. Admin-merged (OOS BLOCK on pre-existing #7/#8/#9). Closed #8, #21.

Full 89-city batch run: 82/88 succeeded; 6 transient retried and cleared. Reached 277/288 Firestore cities. 11 permanently-thin cities confirmed as structurally blocked.

## Session 2026-05-02/04 (session 6) summary

PRs merged: #48 (session 5 close docs), #49 (backfill + rename + scraper disambiguation — admin-merged OOS BLOCK). Ran 26-city batch (modes: Gemini direct), reached 269 cities. birmingham-al stale neighborhood cleanup. Firebase projectId fix. Atlas Obscura US URL slug fix (`{city}-{state}` not `{city}-united-states`). Confirmed 11 small towns permanently thin.

## Session 2026-05-01 (session 5) summary

Entire PR queue cleared (#40, #42, #43, #44, #45, #46). Firestore audit: 260 cities, 12,123 wps, 28,419 tasks. city_id backfill on 21,368 vibe_tasks. birmingham-al duplicate deleted. Timeout scraper disambiguation fixed (PR #49 opened).

## When you come back to this repo

Cold-start checklist:

1. Read this file top-to-bottom.
2. `git log --oneline -10` for recent commits.
3. `gh pr list` — check PR #56 and #57 council status.
4. `gh run list --workflow branch-guard.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion'` → confirm `"success"` before any ingest run.
5. Read `.harness/learnings.md` most recent entry for session context.
