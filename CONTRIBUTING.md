# Contributing to city-atlas-service

This repo is the shared data pipeline feeding Urban Explorer and Roadtripper. Most work lands through pull requests gated by a Gemini-powered review council.

---

## Getting started

```bash
git clone https://github.com/Anguijm/city-atlas-service.git
cd city-atlas-service
cp .env.example .env.local

# Fill in .env.local:
#   GEMINI_API_KEY=<from firebase apphosting:secrets:access or Google AI Studio>
#   GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/application_default_credentials.json
#   GOOGLE_CLOUD_PROJECT=urban-explorer-483600
#   FIRESTORE_DATABASE=urbanexplorer       # named database; rename to travel-cities was planned but never executed

npm install                                          # node deps (scrapers, TS ingest)
pip install -r requirements.txt                      # python runtime deps
pip install -r requirements-dev.txt                  # python dev deps (pytest)
pip install -r .harness/scripts/requirements.txt     # council deps (local dev only)

gcloud auth application-default login                # once, for Firestore Admin SDK
```

See `SESSION_HANDOFF.md` for the full runbook.

---

## Development workflow

This is a **TDD cadence** with a council gate on every PR. Per `CLAUDE.md`:

1. **Plan.** Describe the change and its risk surface in the PR description. Link affected files, schemas, and consumers.
2. **Tests first.** vitest for TypeScript (`npm run test`), pytest for Python (`python3.12 -m pytest src/pipeline/`). Get them red on the new behavior before writing code.
3. **Implement.** Smallest diff that makes tests green.
4. **Push and let council review.** The 7-persona Gemini review runs automatically on every push. Address remediations as follow-up commits on the same branch; council auto-reruns.
5. **Merge after 🟢.** Admin-override is available for cases where the council is drifting on pre-existing or out-of-scope concerns — use it judiciously and file follow-up issues for legitimate findings.

### Branch and commit conventions

- Branch names: `fix/*`, `feat/*`, `port/*`, `refactor/*`, `docs/*`.
- Keep branches focused on one concern.
- Write commit messages that explain the **why**, not just the what. Wrap at ~72 cols.
- Every commit co-authored by Claude should carry the `Co-Authored-By: Claude...` trailer.

### What counts as a breaking change

- Any edit to `src/schemas/cityAtlas.ts` — that file is the cross-consumer contract. Consumers (UE, Roadtripper) copy or git-import; no published npm package. Breaking changes require coordinated deploys to both consumer repos.
- Any change to Firestore `cities/*`, `neighborhoods/*`, `waypoints/*` document shapes.
- Rule changes in `firestore.rules` that tighten reads for existing consumer collections.

---

## The council gate

Every PR triggers `.github/workflows/council.yml`. Seven personas (architecture, cost, bugs, security, product, accessibility, lead-architect-synthesis) review the diff via Gemini 2.5 Pro. Lead Architect synthesis posts as a single re-editable PR comment with:

- 🟢 CLEAR — merge
- 🟡 CONDITIONAL — address the remediations and push; council re-runs
- 🔴 BLOCK — rethink the change (or admin-override if you judge the BLOCK to be synthesizer drift on pre-existing or out-of-scope concerns)

Persona definitions live in `.harness/council/*.md`. See `.harness/README.md` for the full protocol, budget caps, and how the CI and local runners relate.

### Skipping council

`[skip council]` (case-insensitive) in the PR title bypasses the workflow. Reserved for emergency hotfixes; leaves a traceable audit gap.

### The halt

To pause the pipeline or the council globally, create `.harness_halt` at the repo root with a one-line reason. Both `council.yml` and `pr-watch.yml` silent-exit on next trigger. Remove the file to resume. See `.harness/halt_instructions.md`.

---

## Tests

### TypeScript (vitest)

```bash
npm run test                # one-shot
npm run test -- --watch     # during iteration
```

Test files live under `src/__tests__/*.test.ts`. Covers scrapers, Firestore writers, and the cross-consumer Zod schemas.

### Python (pytest)

```bash
python3.12 -m pytest src/pipeline/ -v
```

Pipeline tests in `src/pipeline/test_*.py`. Today these cover the Phase C proportional threshold, deterministic hallucination-name matching, and keyword coverage. Deeper Python coverage (mocking Gemini + Firestore for integration tests over `phase_c_validate`) is on the roadmap — see `SESSION_HANDOFF.md`.

### Linting / formatting

- TypeScript: `npx tsc --noEmit` (runs in CI as the `validate` check).
- Python: no linter wired yet; match existing style.
- Secret scanning: `gitleaks` runs in CI via `.github/workflows/ci.yml`. Pre-commit hook at `.harness/hooks/pre-commit` runs it locally if you install the hooks (`bash .harness/scripts/install_hooks.sh`).

---

## Firestore discipline

The pipeline has god-mode on Firestore via the Admin SDK. Guards in code (e.g., `enrich_ingest.ts`'s `source: "enrichment-*"` filter) are load-bearing. Rules of engagement:

- **Pipeline writes:** `cities/{cityId}` + nested `neighborhoods/`, `waypoints/`, `tasks/` subcollections; flat denormalized `vibe_neighborhoods/`, `vibe_waypoints/`, `vibe_tasks/`; `seasonal_variants/`, `pending_research/`, `health_metrics/`. (No `tasks_rt`/`tasks_ue` — per-consumer task differentiation is a field on individual task docs, not separate collections.)
- **Pipeline must NOT write:** `saved_hunts/*` (app-owned, client-writable via `firestore.rules`), `cache_locks/*` (read-side concurrency primitive).
- Admin SDK bypasses `firestore.rules` by design. Don't rely on rules as the only line of defense when writing from this repo.

---

## Cost discipline

- **Gemini 2.5 Pro**: 3–4 calls per city per full pipeline run. Budget is per-enrichment-cycle, not per-request. The Phase C hardening in PR #4 swapped a second LLM call for a deterministic matcher; don't re-add model-in-the-loop patterns without strong justification.
- **Council**: capped at ~10 Gemini calls per PR via GitHub Actions cache; hard enforced via `.harness_halt` if budget exceeds.
- **Scraper rate limits**: Wikipedia 1/sec, Reddit 1/2s, Playwright 1/30s per city. Rate-bans are data loss — respect the limits.

---

## Reporting issues

1. Check existing issues first.
2. Open an issue with:
   - **Summary** — one-liner.
   - **Repro** — minimal steps. Include the city ID if applicable.
   - **Expected vs actual** — what should have happened.
   - **Logs** — include the `AUDIT_DELETION` line if Phase C cleanup is involved, or the full Gemini reason text for audit-failure issues.
3. Label as `bug`, `enhancement`, `docs`, or `security`.

Security issues (prompt-injection vectors, Admin SDK scope creep, dependency compromise) — file as an issue with the `security` label or contact the maintainer directly for responsible disclosure of non-public vectors.

---

## Feature requests

Open an issue titled `feat: ...` with:

- **Use case** — what are you trying to do, and for which consumer (UE, Roadtripper, both)?
- **Proposed approach** — optional but helpful. If it crosses the schema boundary, flag that early.
- **Alternatives considered** — also optional; shortens the review cycle.

For larger directions, the "What's next for this repo" section of `SESSION_HANDOFF.md` is where roadmap-shaped items live.

---

## Maintainer decisions and scope

This is a pipeline-only repo. **Consumer-facing features (UI, session, account, onboarding) do NOT belong here** — they live in the Urban Explorer and Roadtripper repos. If an issue's fix requires a consumer-side change, link the consumer-repo issue and scope this side to the schema/ingest portion.

---

## License

See `LICENSE`.
