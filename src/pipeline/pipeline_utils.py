"""
Shared utilities for pipeline entry points (batch_research.py, research_city.py).
Keep this module import-light: only stdlib, no third-party deps. It must be
importable before any Firebase / Gemini credentials are available.
"""

import re
import subprocess
import sys

# Allow-list for city IDs used as file paths and subprocess arguments.
# Accepts only lowercase ASCII letters, digits, and hyphens — no slashes,
# dots, or shell metacharacters. Change this only if the city-ID convention
# changes globally (update global_city_cache.json slugs in lockstep).
CITY_ID_RE = re.compile(r"^[a-z0-9-]+$")


def check_branch_guard() -> None:
    """Abort if main's last branch-guard run is not green.

    Prevents writing to Firestore from a main commit that bypassed PR review.
    Fails open (warn + proceed) in three non-fatal cases:
      - gh CLI unavailable (FileNotFoundError)
      - gh timed out (TimeoutExpired)
      - gh exited non-zero (auth failure, rate limit, etc.) — CalledProcessError
        would not be raised because we use check=False, but returncode is checked
      - no runs found (empty stdout with returncode 0)

    Hard-fails when conclusion is a known non-success string ("failure",
    "cancelled", "skipped", etc.) — that indicates an actual branch-guard
    violation on main, not an infrastructure hiccup.
    """
    try:
        result = subprocess.run(
            [
                "gh", "run", "list",
                "--workflow", "branch-guard.yml",
                "--branch", "main",
                "--limit", "1",
                "--json", "conclusion",
                "--jq", ".[0].conclusion",
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,  # we inspect returncode ourselves
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        print("⚠ WARNING: Could not verify branch-guard (gh unavailable or timed out). Proceeding.")
        return

    # gh exited non-zero: auth error, rate limit, network issue, etc.
    # Fail open rather than blocking all pipeline runs when gh is misconfigured.
    if result.returncode != 0:
        stderr = result.stderr.strip()
        detail = f": {stderr}" if stderr else ""
        print(f"⚠ WARNING: gh exited {result.returncode}{detail}. Could not verify branch-guard. Proceeding.")
        return

    conclusion = result.stdout.strip()

    if conclusion == "success":
        return
    if not conclusion:
        # No runs exist yet for this workflow on main (new repo or first push).
        print("⚠ WARNING: No branch-guard runs found on main. Proceeding.")
        return

    # Known non-success conclusion: an actual branch-guard violation.
    print(f"ERROR: branch-guard.yml last run on main is '{conclusion}', not 'success'.")
    print("  A direct push to main may have bypassed PR review.")
    print("  Check: https://github.com/Anguijm/city-atlas-service/actions/workflows/branch-guard.yml")
    print("  Re-run the workflow on main, or resolve the offending commit before writing to Firestore.")
    sys.exit(1)
