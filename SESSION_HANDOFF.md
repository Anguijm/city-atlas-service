# Session Handoff — city-atlas-service

> Living document. Last refreshed 2026-04-26 (pt3) at end-of-session. Edit in
> place rather than appending date-stamped blocks — this is the "what would
> you want to know on day one" index, not a changelog.
>
> **For session-by-session learnings, see `.harness/learnings.md`** (append-
> only; KEEP / IMPROVE / INSIGHT / COUNCIL blocks per task).
>
> **For active work tracking, see `BACKLOG.md`** at repo root.

## Start here next session

- **`main` HEAD:** `95c29ce` (PR #27 — branch-guard retry-with-backoff for API eventual consistency)
- **Last substantive merge:** same — `95c29ce`. Production data also moved this session: **honolulu ingested**, parked-metros backlog now **16/16** in the `urbanexplorer` named database.
- **Open PRs:** session-close PR pending if the assistant left it open. Working tree expected clean otherwise.
- **Top-priority next actions, in order:**
  1. **Council-tightening sprint: #16 + #23 together.** #16 extends `.harness/scripts/council.py` to fetch prior council comment + submitter response and prepend to round-N persona prompts (~50–80 lines). #23 tightens the lead-architect rule so `score ≤4` requires a non-empty concern body before triggering BLOCK (one-line edit to `.harness/council/lead-architect.md` plus possibly persona-prompt recalibration). PR #27's R1 🟢 CLEAR with `product: 6` shows the synthesizer can read this case correctly — but PR #22 didn't, so the rule needs to be explicit, not implicit.
  2. **Issue #21 — automate branch-guard preflight inside pipeline entry points.** Round-3 council ask on PR #20, deferred. Defense-in-depth on production writes. **PR #27's retry pattern (4-attempt loop, 5s/10s/15s backoff over `gh api /commits/{sha}/pulls`) is the copy-pasteable template** for the eventual-consistency handling this helper needs.
  3. **Issue #12 — CI smoke-test on entry-point scripts.** Three porting-miss bugs across prior sessions; pattern is well-established. Now compounded by the `--ingest-only --enrich` flag-composition gotcha documented in pt3 learnings (additive ingest, no Phase B re-run).
  4. **Issue #17 — unit tests for `geoBoundsFor` + Infatuation HTML fixtures.** Cheap follow-up from PR #15 R2.
- **Blockers:** none. CI failures on `validate` and `watch` remain pre-existing tech debt unrelated to any session diff. The `branch-guard` check now passes reliably on every legitimate PR merge (validated end-to-end on `95c29ce`'s own merge commit, which is the very class of bug PR #27 fixes).
- **Doctrine reminders for next session:**
  - **All changes to main MUST go through PRs.** Direct push fails the `branch-guard` workflow post-hoc and leaves a paper trail in the Actions tab. As of PR #27 the workflow self-heals over GitHub API eventual consistency — false-positive failures on freshly-merged commits are gone.
  - **Branch-guard preflight before pipeline writes.** Run `gh run list --workflow branch-guard.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion'` and confirm `success` before any `--ingest`/`--ingest-only` invocation. The retry-with-backoff fix means false RED is no longer expected; if you see RED on HEAD, treat it as real and investigate.
  - Database name is `urbanexplorer`, NOT `travel-cities`. Schemas are at `src/schemas/cityAtlas.ts`, NOT a published npm package. Tasks live nested under cities + flat in `vibe_tasks`, NOT in `tasks_rt`/`tasks_ue`. (CLAUDE.md "Firestore discipline" section has the full rundown.)

## What this repo is

`city-atlas-service` is the shared data pipeline that scrapes public sources
(Wikipedia, Reddit, Atlas Obscura, The Infatuation, TimeOut, Locationscout),
runs four Gemini phases (research → structure → validate → ingest), and
writes neighborhoods + waypoints + tasks to the `urbanexplorer` named
Firestore database (in GCP project `urban-explorer-483600`) consumed by:

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

`main` = `95c29ce` at the end of the 2026-04-26 (pt3) session. Recent history:

```
95c29ce branch-guard: retry commit→PR lookup to absorb GitHub API eventual consistency (#27)
058d123 Session close 2026-04-26 (continued): docs refresh after PR #19/#20/#22 (#24)
942dc50 Fix branch-guard: add pull-requests: read permission (#22)
f3a9f5e Branch Guard workflow: post-hoc detect direct pushes to main (#20)
c9f8985 CLAUDE.md: honest doctrine + reconcile docs with code reality (#19)
4522361 CLAUDE.md: codify round-N drift doctrine + submitter response format (#18)
1f04365 Refine scrapers per issue #11: Atlas Obscura overrides, Infatuation finder, retire SBL (#15)
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
  atlas-obscura-slugs.json # city-id → URL slug suffix override (PR #15)
  urban-explorer/tasks.yaml # per-app task-prompt scaffolds (stub)
  roadtripper/tasks.yaml    # per-app task-prompt scaffolds (stub)
src/
  scrapers/
    atlas-obscura.ts       # Playwright (consults configs/atlas-obscura-slugs.json)
    local-sources.ts       # Playwright (handles 3 sources: the-infatuation, timeout, locationscout)
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
    test_phase_c_threshold.py  # 41 pytest cases (PR #4 + localized-name regressions)
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
  `HALLUCINATION_KEYWORDS`, and 41 pytest cases (was 31; localized-name
  regression cases were added when boston validation surfaced the
  `dict`-vs-`str` shape bug).
- **Three porting-miss bug-fix commits** discovered by running entry-
  point scripts directly during validation, all dormant since the
  2026-04-23 extraction:
  - `90b8c2a` — Python path constants (`research_city.py` /
    `batch_research.py` / `add_coverage_tiers.py`).
  - `f627d83` — TypeScript scraper path constants
    (`wikipedia.ts` / `reddit.ts` / `atlas-obscura.ts` /
    `local-sources.ts` / `qc_cleanup.ts`).
  - `1f173b7` — `--ingest-only` flag composition: the `args.ingest_only`
    branch in `research_city.py` dropped `enrich=args.enrich` when
    routing to `phase_d_ingest`, hardcoding the `build_cache.ts`
    baseline path instead of `enrich_ingest.ts`. Same branch now
    skips Phase C re-run entirely (matches the docstring promise).
- **End-to-end production validation** — re-scraped Wikipedia + Reddit
  for all 19 parked cities (bug fixed by `f627d83`), re-ran the batch:
  16/18 cities completed (4 verified, 12 degraded), 2 failed. Then
  ingested the 16 successes into the `urbanexplorer` named database as
  `source: "enrichment-*"` documents. **15 landed cleanly**; honolulu
  is a Gemini-variance casualty of the pre-`1f173b7` `--ingest-only`
  bug, recoverable in one step.

Net effect: 15 of 19 parked metros are now live in the `urbanexplorer`
named database. 4 ship `quality_status: verified` (boston, houston,
melbourne, tokyo) — the first verified data ever produced from this
repo. UE and Roadtripper can begin consuming the new dataset.

## Open follow-up issues

Filed during the 2026-04-23/25 session; none are merge blockers, all are tracked:

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
- **#11** — Scraper refinement: Atlas Obscura URL pattern (live site has
  `/things-to-do/<city>-<state>` slugs that our scraper doesn't try),
  The Infatuation finder endpoint (search-driven, not city-path), retire
  Spotted by Locals (per user review, source has yielded little to nothing).
- **#12** — CI smoke-test on entry-point scripts. Three porting-miss
  bugs this session — Python paths (`90b8c2a`), TS scraper paths
  (`f627d83`), `--ingest-only` flag composition (`1f173b7`) — all caught
  by manual entry-point invocation, none by existing tests. CI step
  that runs `--help` / `--smoke` on each entry point would catch the
  next instance in <60 sec of the offending push.

Closed during the session: **#10** (scraper malfunction on parked
metros — root cause was the TS path-constants bug; fix landed in
`f627d83`; closed once the post-fix batch validated 16/18 success).

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
3. **19 parked cities — 16 unparked, 2 still failing as legit edge cases.**
   - PR #4's proportional Phase C threshold landed (`a733650`); issue #10 surfaced and was fixed (`f627d83`) during validation; final re-run with fresh Wikipedia + Reddit landed **16/18 cities completed (4 verified, 12 degraded), 2 failed**.
   - Verified (`quality_status: verified`): boston, houston, melbourne, tokyo. First verified outputs ever produced from this repo.
   - Degraded but shipped: algiers, buenos-aires, cincinnati, denver, fukuoka, honolulu, las-vegas, muscate, nashville, osaka, rome, shanghai.
   - Still failing: **geneva** (English Wikipedia only 3.4 KB; minor English-language Reddit presence) and **lisbon** (Portuguese subreddits dominate over r/lisbon). Both are at the structural limit of English-only source coverage — Phase B fabricates over the gap and Phase C correctly rejects. Likely candidates for a language-aware Phase A prompt extension or non-English source addition (see issues #11, future).
   - **London** absent from the manifest's `cities` list despite being in `configs/global_city_cache.json` — the 18-of-19 mismatch hasn't been investigated yet. Carryover for next session.
   - Boston's individual re-research (foreground, before the batch) showed the rescue path firing observably: `REMOVED: 2 hallucinated waypoints` + the `AUDIT_DELETION {...}` JSON line. PR #4's full design — deterministic matcher, cleanup, audit log — all worked exactly as specified on real Gemini output. **First end-to-end production validation of the hardening.**
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
#   FIRESTORE_DATABASE=urbanexplorer       # named database; the rename to travel-cities was planned but never executed

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
- **16/16 parked metros are in Firestore** as enrichment-tagged documents (algiers, boston, buenos-aires, cincinnati, denver, fukuoka, honolulu, houston, las-vegas, melbourne, muscate, nashville, osaka, rome, shanghai, tokyo). 4 verified (boston, houston, melbourne, tokyo); 12 degraded. **Honolulu landed in pt3** via `enrich_ingest.ts` additive path with `--ingest-only --enrich`: 5 nbhd / 19 wp / 100 tasks / `coverageTier: metro`. Waypoint count is on the low end for a metro — rerun `python src/pipeline/research_city.py --city honolulu --enrich` (no `--ingest-only`) if a count bump is needed.
- **Council-tightening sprint #16 + #23** — highest-leverage open work. See "Top-priority next actions" above.
- **Pipeline preflight automation #21** — copy PR #27's retry pattern into a helper called from each ingest entry point.
- **Investigate London absence from manifest** — london is in `configs/global_city_cache.json` but missing from `manifest.cities`. Quick cause-finder: did batch_research's `load_cities` filter london out, or is the manifest simply out of date?
- **Investigate geneva + lisbon failures.** Both are limit-cases on English-only source coverage. Worth a manual Phase A run with a language-aware variant of the prompt to confirm, then file as scoped follow-up.

### Short (~30 min each)
- **Close out follow-up issues** #5–#9 as priorities allow. None are
  merge blockers but #8 (city-ID sanitization) is a prerequisite for
  the incremental-queue and ops-console items below.

### Medium (~2 hrs each)
- **Stage 1: stand up cross-consumer schema sharing** — `src/schemas/cityAtlas.ts`
  is currently consumed by copy or git-import; no published npm package. If
  this trips a versioning need, the lift is "publish to GitHub Packages" plus
  consumer-side dependency adoption. Not blocking; consumers work today by
  copying the file.
- **Wire `--app {ue|roadtripper}` flag** — the per-consumer task-template
  split. The `configs/urban-explorer/tasks.yaml` + `configs/roadtripper/
  tasks.yaml` scaffolds exist already; the flag wiring in `research_city.py`
  + `batch_research.py` selects the config. Per-consumer task differentiation
  lives on individual task docs (the `app` field), not in separate
  `tasks_rt`/`tasks_ue` collections. Council will likely BLOCK first round
  — normal.
- **Python integration tests for `phase_c_validate`** — mock Gemini +
  Firestore; council has asked for these on PR #4 and future Phase C
  changes. The unit-level helpers (`phase_c_threshold`,
  `find_hallucinated_names`, `HALLUCINATION_KEYWORDS`) have 31 pytest
  cases (now 41 after the localized-name regression suite landed); the
  integration surface (full flow + mocked external I/O) is the next
  step.

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

Cold-start checklist (in order):

1. Read this file end-to-end.
2. Read `.harness/learnings.md` — append-only KB; the 2026-04-25 (cont.)
   block is the most recent entry. KEEP / IMPROVE / INSIGHT / COUNCIL
   sections give you the operating wisdom that hasn't crystallized into
   protocol yet.
3. Read `CLAUDE.md` for protocol (council workflow, Firestore /
   cost / halt discipline). Authoritative; everything else defers.
4. Read `src/pipeline/README.md` for how the Python + TypeScript layers
   fit together + the Phase C hardening story (find_hallucinated_names,
   AUDIT_DELETION, escalation guards).
5. `git log --oneline -10` for recent commits. Last activity 2026-04-25.
6. `gh pr list --repo Anguijm/city-atlas-service` for any open PRs.
7. `gh issue list --repo Anguijm/city-atlas-service` for the follow-up
   backlog (currently #5–#9, #11, #12 — see "Open follow-up issues"
   block above for the canonical list).
8. **Top of queue right now**: see the "Top-priority next actions" block
   above and "Roadmap > Now (top of queue)" below. As of 2026-04-26 (pt3)
   close, the priority items are the council-tightening sprint
   (#16 + #23) and the branch-guard preflight automation (#21).
9. If running locally: follow the RUNBOOK above. Note the `--ingest-only`
   semantics changed in `1f173b7` (now skips Phase C re-run + routes
   correctly through `enrich_ingest.ts` when paired with `--enrich`).
10. If debugging council: `gh pr view <N> --comments` surfaces the
    latest Lead Architect synthesis. The `.harness/last_council.md`
    artifact (local-runner output) doesn't exist in this repo —
    council has only ever run via PR-time GitHub Actions, not locally.

### What "production-ready" means right now

The pipeline produces live data. 16 metros are in the `urbanexplorer`
named database as `enrichment-*` documents (4 verified, 12 degraded). The
remaining work is **refinement** (more scraper sources, source-quality
scoring, Cloud Run scheduling, ops console, types-package extraction)
not **bring-up**.
