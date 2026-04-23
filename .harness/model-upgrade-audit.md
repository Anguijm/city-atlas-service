# Model upgrade audit

Run through every layer below whenever you swap a model (Gemini pipeline version, Gemini council version, or the Claude model used by the PR watcher). Skipping a layer is how regressions ship.

Adapted from the yolo-projects 5-layer model-swap checklist, tailored for a Python + TypeScript pipeline whose model surface is Gemini-primary (research, structuring, validation, council) with Claude as the PR watcher only.

## 1. Config

- [ ] Model ID updated in the single source of truth: hard-coded strings in `src/pipeline/research_city.py` (`model="gemini-..."` callsites), `.harness/scripts/council.py` default, `.github/workflows/pr-watch.yml` for the Claude watcher.
- [ ] No stray references to the old model ID anywhere in the repo. Grep for the old ID before committing.
- [ ] Env vars overrides (`HARNESS_MODEL`) documented in `SESSION_HANDOFF.md` and `CLAUDE.md` if changed.

## 2. Callsites

- [ ] Every callsite that used the old model is either migrated or explicitly opted into staying on the old model (with a comment).
- [ ] SDK parameters still valid: `temperature`, `response_mime_type`, `system_instruction` shape, `GenerateContentConfig` options, streaming flags.
- [ ] Gemini-specific: `client.models.generate_content(model=...)` calls use the new model ID. Phase A/B (Gemini Pro) and Phase C (Gemini Flash) are separate knobs — don't conflate.

## 3. Prompts

- [ ] System prompts still produce the expected shape of output. Newer models can be stricter about instruction-following or more verbose.
- [ ] `response_mime_type: application/json` still yields parseable output on the new model — run a sample through the JSON-decode path before merging.
- [ ] Phase A historical-guard regex still matches (vitest test pins it).
- [ ] Phase C `HALLUCINATION_KEYWORDS` coverage still triggers correctly — run the `TestHallucinationKeywords` pytest class.

## 4. Tests

- [ ] `npm run test` (vitest) green on the scraper + Firestore-writer suites.
- [ ] `python3.12 -m pytest src/pipeline/` green on the 31 Phase C cases.
- [ ] Manual smoke test: one representative city end-to-end (e.g., `python3.12 src/pipeline/research_city.py --city boston --enrich`) with the new model; compare the resulting JSON to a baseline from the old model.

## 5. Costs

- [ ] New model's price-per-token documented in the callsite comment.
- [ ] Gemini call budget (3–4 Pro calls per full pipeline run per city) still fits the per-enrichment-cycle envelope.
- [ ] Council call cap (~10 Gemini calls per PR) still enforced in `council.yml`.
- [ ] Rate limits adjusted if the new model has different TPM/RPM ceilings.
- [ ] Batch-level cost sanity-check: a 185-city full enrichment shouldn't exceed the previous cycle's total spend without explicit justification.

## Post-swap smoke test

1. Run the Gemini council on a representative PR (or `git diff`) with the old model, save the output to `.harness/memory/pre-swap-council.md`.
2. Swap the model.
3. Run the council again on the same diff; save to `.harness/memory/post-swap-council.md`.
4. Diff the two. Confirm scores and non-negotiables are consistent in direction (±1 per angle is fine; swings of 3+ are a red flag).
5. Spot-check one full `research_city.py` run against the new model on a city with known-good baseline JSON.

## Rollback plan

Every model swap commit must describe how to revert:

- The single config change to revert (model ID string).
- Any prompt changes that must be reverted alongside.
- Whether the council persona files need updating (usually no, but major Gemini version jumps may change default output format or instruction-following style).
- Whether Phase C `HALLUCINATION_KEYWORDS` needs expanding for the new model's audit-reason vocabulary.

## Never

- Swap model *and* change prompt in the same PR. Split them so regressions can be attributed.
- Swap to a preview / experimental model ID on a production path. Preview models can be deprecated with 30 days' notice.
- Swap the pipeline model and the council model in the same PR — you lose the ability to blame a PR regression on either change in isolation.
