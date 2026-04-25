# Claude Code Operating Protocol — city-atlas-service

This is the pipeline repo. It produces the shared city atlas that Urban Explorer and Roadtripper both consume via Firestore + the `@travel/city-atlas-types` package.

## The council is the audit gate

Every merge to `main` is gated by `.github/workflows/council.yml` — a 7-persona Gemini review (architecture, cost, bugs, security, product, accessibility, lead-architect-synthesis). The Lead Architect synthesis posts a single re-editable PR comment with a verdict: 🟢 CLEAR | 🟡 CONDITIONAL | 🔴 BLOCK.

**Default: you cannot merge without a 🟢.** CONDITIONAL = address the remediations in a follow-up commit; council auto-reruns. BLOCK = rethink the change.

**Admin override** (`gh pr merge --admin`) exists for the case where the council surfaces legitimate concerns that are **out-of-scope for the current diff** — pre-existing repo issues, infrastructure remediations the PR can't address (e.g., "configure a Cloud Logging alert pipe"), or recurring synthesizer drift on the same surface across multiple rounds. Use admin override responsibly:

- File follow-up issues for every legitimate concern the council raised. The override is escape-hatch-from-this-PR, not dismissal of the feedback.
- Document the rationale in the merge commit message.
- Reserved for non-emergencies. `[skip council]` in the PR title is the *emergency* lever (skips the workflow entirely); admin override is the *judgment* lever (council ran, you considered the verdict, you chose to merge anyway with paperwork).
- Two examples from this session: PR #3 (admin-override on a markdown-only diff because security 3/10 was driven by three pre-existing scraper concerns outside the diff scope; filed as #7/#8/#9), PR #4 (admin-override after five rounds when the remaining BLOCK remediation was an SRE alert-pipe configuration outside this code repo; filed as #5).

This replaces the ad-hoc `mcp__gemini__ask-gemini` audit protocol used in the urban-explorer repo. MCP-based audits remain available as a local dev-time sanity check but are not the merge gate.

## Write / Plan / Implement workflow

Follow a TDD-style cadence for code changes. The council runs once per push to PR.

1. **Write a plan.** Before cutting code, describe the change + risk surface in the PR description. Link to affected files, schemas, and consumers.
2. **Write tests first.** vitest for TS, pytest for Python. Run locally until RED for the new behavior.
3. **Implement.** Smallest diff that makes tests GREEN.
4. **Push and let council review.** Address remediations as follow-up commits on the same branch.
5. **Merge after 🟢.** Squash or merge commit — both fine. `[skip council]` in the PR title is reserved for emergency hotfixes only and leaves a traceable audit gap.

## What lives where

- **`src/schemas/`** — Zod schemas published as `@travel/city-atlas-types`. **Cross-consumer contract.** Breaking changes require a semver major + coordinated deploys to both consumer repos.
- **`src/scrapers/`** — seven source-specific scrapers (TS + Python). Each writes `.md` files to `data/{source}/{city}.md`. `.json` sidecar files are optional metadata; Phase A reads only `.md`.
- **`src/pipeline/`** — `research_city.py`, `batch_research.py`, `phase_c_threshold.py` (proportional-FAIL helper), `build_cache.ts` (baseline ingest, strict Zod), `enrich_ingest.ts` (additive enrichment, no Zod, gated by `source: "enrichment-*"`), `qc_cleanup.ts`. Phase A/B/C/D orchestration. Pytest tests at `test_phase_c_threshold.py`.
- **`configs/`** — `global_city_cache.json` (185-city metadata), `seasonal-calendar.json`, `{app}/tasks.yaml` per-consumer task-prompt templates.
- **`data/{source}/`** — scraped markdown. Git-tracked so the pipeline is deterministic.
- **`.harness/`** — council personas, scripts, hooks, evidence cache. See `.harness/README.md` for local protocol.

## Firestore discipline

- Database name: `travel-cities` (renamed from `urbanexplorer` during extraction).
- Pipeline writes: `cities/*`, `cities/*/neighborhoods/*`, `.../waypoints/*`, `tasks_ue/*`, `tasks_rt/*`, `seasonal_variants/*`, `vibe_*`, `pending_research/*`, `health_metrics/*`.
- Pipeline must NOT write: `saved_hunts/*` (app-owned), `cache_locks/*` (read-side concurrency primitive).
- Admin SDK bypasses rules; `enrich-ingest.ts`'s `source: "enrichment-*"` filter is load-bearing — don't regress it.

## Cost discipline

- Gemini 2.5 Pro: 3–4 calls per city per full pipeline run. Budget is per-enrichment-cycle, not per-request.
- Council: capped at ~10 Gemini calls per PR via GitHub Actions cache; hard enforce via `.harness_halt` if budget exceeds.
- Scraper rate limits: Wikipedia 1/sec, Reddit 1/2s, Playwright 1/30s per city. Rate-bans are data loss.

## Halt

If the pipeline is producing bad data or council is spiraling on a change:

1. Create `.harness_halt` at the repo root with a one-line reason.
2. Council + pr-watch workflows will silent-exit on next trigger.
3. Remove the file to resume.

## Cross-repo links

- **Consumers:** `urban-explorer` (Next.js), Roadtripper (separate repo).
- **Shared package:** `@travel/city-atlas-types` (published from this repo).
- **Migration plan:** `/home/johnanguiano/.claude/plans/i-think-we-need-soft-salamander.md` (local, not committed).
