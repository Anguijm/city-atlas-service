# Council

Each `*.md` file in this directory (other than this README and `lead-architect.md`) defines a reviewer persona. The Gemini runner (`../scripts/council.py`) dispatches them in parallel and then runs the Lead Architect synthesis.

## Active angles

| File | Role | Scope |
|------|------|-------|
| `security.md` | Security Reviewer | `firestore.rules`, Admin SDK scope, secret handling, prompt injection, supply chain, subprocess safety |
| `architecture.md` | Architecture Reviewer | Pipeline boundaries (Python orchestrator + TS writers), `cityAtlas.ts` cross-consumer contract, idempotency, manifest semantics |
| `product.md` | Product Reviewer | UE vs Roadtripper consumer impact, coverage tier calibration, degraded-vs-rejected trade-offs, per-app task semantics |
| `bugs.md` | Bug Hunter | Phase C semantic audit coverage, Gemini hallucination/coordinate drift, manifest races, subprocess non-determinism, historical-guard regression |
| `cost.md` | Cost Reviewer | Gemini Pro budget per cycle, scraper rate limits, council call cap, cache effectiveness |
| `accessibility.md` | Accessibility Reviewer | Machine-parseable log output, operator ergonomics, no UI surface here so the scope is narrow |
| `lead-architect.md` | Resolver (synthesizes the above into one verdict) |

## Adding a new angle

1. Create `<angle>.md` in this directory following the persona shape in any existing file:
   - One-sentence role statement ("You are a <Role>...").
   - Scope list.
   - Review checklist (numbered questions).
   - Output format (fenced block).
   - Scoring rubric (1–10).
   - Non-negotiables (veto power).
2. The runner auto-picks it up — no code change.
3. Smoke-test by running `python3 ../scripts/council.py --plan .harness/active_plan.md` and confirm the new angle appears in `.harness/last_council.md`.
4. Append the entry to the table above in this README.

## Removing an angle

Delete the file. The runner skips it on the next invocation.

## Disabling an angle temporarily

Rename to `<angle>.md.disabled`. The runner only loads files ending in `.md`.

## Cost cap

The runner enforces 15 Gemini calls per run (hard). Adding a new angle eats one of those slots. If you're near the cap, remove a weaker angle before adding a new one.

## Style invariants for new personas

- No emojis.
- Opening line: `You are a <Role> examining a development plan for city-atlas-service...`
- Always include non-negotiables that grant veto power (so the Lead Architect knows when to reject).
- Keep the checklist actionable — questions, not lectures.
- Output format must be machine-parseable (fenced block with `Score:` on its own line so the log can extract it).
