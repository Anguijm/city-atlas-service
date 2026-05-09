# Claude Code Operating Protocol — city-atlas-service

This is the pipeline repo. It produces the shared city atlas that Urban Explorer and Roadtripper both consume by reading the `urbanexplorer` named Firestore database and importing Zod schemas from `src/schemas/cityAtlas.ts` (copied or git-imported; no published npm package).

## The council is the audit gate

Every change to `main` goes through a PR. `.github/workflows/council.yml` runs a 7-persona Gemini review (architecture, cost, bugs, security, product, accessibility, lead-architect-synthesis) on every PR open + push. The Lead Architect synthesis posts a single re-editable PR comment with a verdict: 🟢 CLEAR | 🟡 CONDITIONAL | 🔴 BLOCK.

**Direct pushes to `main` are flagged by `.github/workflows/branch-guard.yml`** — a post-hoc detector that fails on any push to `main` whose head commit is not associated with a merged PR.

**This is detection, not prevention.** The push has *already landed* when the workflow runs. If a downstream consumer (UE, Roadtripper) is auto-deploying off `main`, an offending direct push could ship to production before the guard fires. **Mitigated today by the absence of any auto-deploy from this repo** — the pipeline is run manually, not on `main` push — but if a deploy hook is ever added, the same "from merged PR" check must be incorporated as the deploy's mandatory first step. Squash-merges, merge commits, and rebase-merges via `gh pr merge` or the GitHub UI all pass — they attach their PR via the GitHub API. Direct `git push` from a workstation fails the check.

GitHub's hard-block branch protection (the preventative equivalent) requires Pro for private repos; revisit if the repo goes public or the team upgrades. Until then, the soft fence + doctrine + Actions-tab paper trail is the bar.

**Default: you cannot merge without a 🟢.** CONDITIONAL = address the remediations in a follow-up commit; council auto-reruns. BLOCK = rethink the change.

**Admin override** (`gh pr merge --admin`) exists for the case where the council surfaces legitimate concerns that are **out-of-scope for the current diff** — pre-existing repo issues, infrastructure remediations the PR can't address (e.g., "configure a Cloud Logging alert pipe"), or recurring synthesizer drift on the same surface across multiple rounds. Use admin override responsibly:

- File follow-up issues for every legitimate concern the council raised. The override is escape-hatch-from-this-PR, not dismissal of the feedback.
- Document the rationale in the merge commit message.
- Reserved for non-emergencies. `[skip council]` in the PR title is the *emergency* lever (skips the workflow entirely); admin override is the *judgment* lever (council ran, you considered the verdict, you chose to merge anyway with paperwork).
- Five examples: PR #3 (admin-override on a markdown-only diff because security 3/10 was driven by three pre-existing scraper concerns outside the diff scope; filed as #7/#8/#9), PR #4 (admin-override after five rounds when the remaining BLOCK remediation was an SRE alert-pipe configuration outside this code repo; filed as #5), PR #15 (admin-override after two rounds when the synthesizer flipped on three surfaces between rounds — log→throw, +15km radius approve→reject, reinstate→remove `places[]`; filed as #14/#16/#17), PR #30 (admin-override after two rounds — security went 3→9 confirming the fix worked; residual BLOCKs were R1 "at-minimum" path contradicted by R2 "must fail CI," and re-raise of a previously-argued-OOS unit-test ask; filed into #17), PR #26 (admin-override after three rounds — R1 🟢 on schema additions; R2+R3 🔴 after bundled CI-fix commits added tsconfig/Node changes to the diff; R3 security 10→4 with no security-relevant changes, and tsconfig explicitly called "deferred nice-to-have" in R2 flipped to "required BLOCK" in R3; filed as #32/#33).

This replaces the ad-hoc `mcp__gemini__ask-gemini` audit protocol used in the urban-explorer repo. MCP-based audits remain available as a local dev-time sanity check but are not the merge gate.

### Round-N drift doctrine

**Cross-round memory landed in PR #30 (`18f150e`, 2026-04-27).** `council.py` now fetches the prior council report + submitter response via `gh api` and injects a `=== PRIOR ROUND CONTEXT ===` block into every round-N persona prompt. The submitter still carries the burden of posting the fixed-format response comment (rule 2 below) so the injected context is complete and structured. Two rules:

**1. Round 2 = unblock or escalate.** If round 2 introduces NEW remediations on the *same surface* as a round-1 prescription you already implemented as specified, you do not owe a round 3. The synthesizer is contradicting itself on a surface you already addressed; admin-override is the right tool. Document the contradiction in the merge commit (round-1 prescription vs round-2 ask, your implementation, why the flip is drift not new evidence). File follow-up issues for any net-new remediations that *aren't* contradictions. Score deltas across rounds are useful evidence in the override paperwork — if N of 6 axes improved meaningfully and the residual blocks are all surface-flips, the override is well-calibrated.

**2. Submitter response comments use a fixed format.** When responding to a council round, post one PR comment with these sections in order:
- **A table** mapping each remediation to status (✅ addressed in code with commit SHA / 🟡 partial with rationale / 🚫 argued out-of-scope).
- **A `## Argued out-of-scope` section** for any rejected remediations, with a one-paragraph reason per item. Reference the issue number that already covers the scope (e.g. #7 for prompt-injection markers across all scrapers, not just the new endpoint).
- **A `## CI failures` section** explicitly noting which check failures are pre-existing vs introduced by the diff, with line numbers / commit SHAs as evidence.

The format matters even with cross-round memory active: it provides the structured signal `council.py` looks for when identifying the submitter response (scanned for `## Argued out-of-scope` or `## CI failures` headers), makes override paperwork obvious to future readers, and gives the lead architect a clear handoff.

## Write / Plan / Implement workflow

Follow a TDD-style cadence for code changes. The council runs once per push to PR.

1. **Write a plan.** Before cutting code, describe the change + risk surface in the PR description. Link to affected files, schemas, and consumers.
2. **Write tests first.** vitest for TS, pytest for Python. Run locally until RED for the new behavior.
3. **Implement.** Smallest diff that makes tests GREEN.
4. **Push and let council review.** Address remediations as follow-up commits on the same branch.
5. **Merge after 🟢.** Squash or merge commit — both fine. `[skip council]` in the PR title is reserved for emergency hotfixes only and leaves a traceable audit gap.

## Code commenting standard

This repo's pipeline is complex — threshold values interact across files, tier logic has non-obvious math, and cross-system constraints (e.g., Phase A's 200-char intake gate) are invisible unless documented. Code must be **human-readable, human-editable, and human-maintainable** by a developer who did not write it and has no access to the PR discussion or council comments.

**Default: comment every non-trivial decision.** This overrides the general Claude Code default of "write no comments unless the WHY is non-obvious." In this repo, almost everything is non-obvious.

What requires a comment:
- **Every numeric constant or threshold** — what it controls, why that specific value, what breaks if it changes, what downstream constraint it must respect (name the file and line number).
- **Every tier-branching decision** — explain what is structurally different about that tier and why the behavior differs, not just that it does.
- **Every accepted tradeoff** — when the code accepts a known risk or chooses between imperfect options, document the reasoning inline. PR descriptions and council comments are not visible to future maintainers editing the file directly.
- **Every cross-system dependency** — if a value is constrained by another file, name that file and line. "Must exceed 200" → "must exceed Phase A's 200-char intake gate in research_city.py lines 338/459/597."
- **Safe modification guidance** — for any constant a developer might want to tune, tell them what to verify before changing it.

The council's `maintainability` persona evaluates comment quality as a scored axis. Undocumented thresholds and branches can trigger BLOCK.

## What lives where

- **`src/schemas/cityAtlas.ts`** — Zod schemas. **Cross-consumer contract.** Consumers (UE, Roadtripper) copy this file or import via git URL (`github:Anguijm/city-atlas-service#main`). No published npm package — earlier `@travel/city-atlas-types` references in this repo were aspirational and should be edited out as found. Breaking changes require coordinated deploys to both consumer repos.
- **`src/scrapers/`** — six sources across four TS files (`atlas-obscura.ts`, `local-sources.ts` covering the-infatuation/timeout/locationscout, `wikipedia.ts`, `reddit.ts`). Each writes `.md` files to `data/{source}/{city}.md`. `.json` sidecar files are optional metadata; Phase A reads only `.md`. Atlas Obscura URL slugs come from `configs/atlas-obscura-slugs.json` overrides + a fallback chain. Spotted by Locals was retired 2026-04-26 (PR #15).
- **`src/pipeline/`** — `research_city.py`, `batch_research.py`, `phase_c_threshold.py` (proportional-FAIL helper), `build_cache.ts` (baseline ingest, strict Zod), `enrich_ingest.ts` (additive enrichment, no Zod, gated by `source: "enrichment-*"`), `qc_cleanup.ts`. Phase A/B/C/D orchestration. Pytest tests at `test_phase_c_threshold.py`.
- **`configs/`** — `global_city_cache.json` (288-city metadata; `birmingham-al` duplicate removed 2026-05-01), `seasonal-calendar.json`, `{app}/tasks.yaml` per-consumer task-prompt templates.
- **`data/{source}/`** — scraped markdown. Git-tracked so the pipeline is deterministic.
- **`.harness/`** — council personas, scripts, hooks, evidence cache. See `.harness/README.md` for local protocol.

## TypeScript configuration

`tsconfig.json` uses `module: ESNext` and `moduleResolution: Bundler`. These were migrated from CommonJS in PR #26 (commit `db99f22`) to fix two pre-existing CI failures:

- **TS1378** — top-level `await` in pipeline scripts requires a module system that supports it; CommonJS does not. ESNext does.
- **TS1324** — dynamic `import()` assertions require ESNext module mode.

`moduleResolution: Bundler` is the correct companion to `ESNext` when the runtime is `tsx` (which handles module resolution itself, not Node's native resolver). Using `Node16` or `NodeNext` with ESNext module output causes false-positive import errors on packages that ship dual ESM/CJS builds.

`lib: ["ES2022", "DOM", "DOM.Iterable"]` — `DOM.Iterable` is needed for `for-of` on DOM collections in scraper code (Playwright iterables). Without it tsc reports TS2488.

**Do not revert to CommonJS** without also auditing all top-level `await` call sites and dynamic imports across `src/pipeline/` and `src/scrapers/`. `tsc --noEmit` must stay clean.

## Firestore discipline

**Before any manual pipeline run that writes to production Firestore** (`research_city.py --ingest`, `enrich_ingest.ts`, `build_cache.ts`, etc.) verify that `.github/workflows/branch-guard.yml` is **green on the HEAD commit of `main`** that you're running from. This closes the manual-run loophole the auto-deploy guard doesn't cover: if someone direct-pushed an unreviewed change to `main` and the guard failed post-hoc, running the pipeline from that HEAD propagates the unreviewed code to production data. Quick check:

```bash
gh run list --workflow branch-guard.yml --branch main --limit 1 --json conclusion --jq '.[0].conclusion'
# expect: "success"
```

If it returns anything else, sync to a known-good commit before running.

- GCP project: `urban-explorer-483600`. Named database: `urbanexplorer` (the rename to `travel-cities` was planned but not executed; code in `enrich_ingest.ts:25`, `build_cache.ts:601,1073`, `qc_cleanup.ts:26`, `backfill_task_neighborhoods.ts:30`, `firestore/admin.ts:20` all point at `urbanexplorer`. Edit any `travel-cities` references out as found, or land the rename and the doctrine together.)
- Pipeline writes (verified against code):
  - `cities/{cityId}` — top-level city metadata
  - `cities/{cityId}/neighborhoods/{nhId}` — nested neighborhood docs
  - `cities/{cityId}/neighborhoods/{nhId}/waypoints/{wpId}` — nested waypoints
  - `cities/{cityId}/neighborhoods/{nhId}/tasks/{taskId}` — nested tasks
  - `vibe_neighborhoods/{id}`, `vibe_waypoints/{id}`, `vibe_tasks/{id}` — flat denormalized copies of the above (same data, faster query)
  - `seasonal_variants/{id}`, `pending_research/{id}`, `health_metrics/{id}` — pipeline observability + scheduling
  - `global_city_cache/{cityId}` — 288-city metadata mirror
- Pipeline must NOT write: `saved_hunts/{huntId}` (app-owned), `cache_locks/{cityId}` (read-side concurrency primitive). Both have rules-level write protection in `firestore.rules`.
- No `tasks_rt/*` or `tasks_ue/*` collections exist. Per-consumer task differentiation happens via the `app` field on individual task docs, not separate collections (verify if this changes).
- Admin SDK bypasses rules; `enrich_ingest.ts`'s `source: "enrichment-*"` filter is load-bearing — don't regress it.

## Cost discipline

- Gemini 2.5 Pro: 3–4 calls per city per full pipeline run. Budget is per-enrichment-cycle, not per-request.
- Council: capped at ~10 Gemini calls per PR via GitHub Actions cache; hard enforce via `.harness_halt` if budget exceeds.
- Scraper rate limits: Wikipedia 1/sec, Reddit 1/2s, Playwright 1/30s per city. Rate-bans are data loss.

## Halt

If the pipeline is producing bad data or council is spiraling on a change:

1. Create `.harness_halt` at the repo root with a one-line reason.
2. Council + pr-watch workflows will silent-exit on next trigger.
3. Remove the file to resume.

## Hook timeouts (settings.json)

`.claude/settings.json` configures two hook timeouts. JSON syntax doesn't allow inline comments, so the rationale lives here:

- **`SessionStart` hook timeout: 10s.** Runs `.claude/hooks/session-start.sh`, which prints last-commit / halt-status / active-plan / last-council-verdict. Typical run < 2s. Failure mode if exceeded: hook is killed and Claude proceeds without the session-start context — risk is missing the halt warning or plan reminder. If timing out regularly, optimize the hook script, don't extend the timeout.
- **`PreToolUse` (Bash) hook timeout: 15s.** Runs `.claude/hooks/check-branch-not-merged.sh` before any Bash tool call. The check involves `git fetch origin main`, which can be slow on poor networks. Failure mode if exceeded: hook fails open and the push is allowed — by design (rather let a push through than block all git activity on a flaky network).

## Cross-repo links

- **Consumers:** `urban-explorer` (Next.js), Roadtripper (separate repo).
- **Shared schemas:** `src/schemas/cityAtlas.ts` in this repo. Consumers copy or git-import — no published npm package.
- **Migration plan:** `/home/johnanguiano/.claude/plans/i-think-we-need-soft-salamander.md` (local, not committed).
