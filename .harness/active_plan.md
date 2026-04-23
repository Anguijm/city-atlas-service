# Active plan

Placeholder. The council runner (`.harness/scripts/council.py --plan .harness/active_plan.md`) reviews whichever plan lives in this file. When starting a new non-trivial change, overwrite this file with the plan for the change and run the council locally before implementation.

See `.harness/README.md` for the full local-council workflow. The PR-time council (`.github/workflows/council.yml`) uses `--diff` mode and does not read this file — `active_plan.md` only matters for local plan-mode runs.
