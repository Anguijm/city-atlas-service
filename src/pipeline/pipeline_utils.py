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

    Fails CLOSED on any outcome that is not a definitive "success" verdict.
    This includes infrastructure failures (gh unavailable, timeout, non-zero
    exit) as well as actual branch-guard violations. The rationale: the blast
    radius of writing unreviewed code to Firestore is the entire production
    dataset; an operator who needs to bypass can temporarily remove the
    check_branch_guard() call site rather than silently proceeding.

    Only way to pass: gh returns returncode=0 and stdout=="success".
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
            # 15s: generous for a single GitHub API call over cloud/corporate networks.
            # Lower → false-positive failures on slow connections; higher → delays the
            # operator's feedback loop without improving reliability.
            timeout=15,
            check=False,  # we inspect returncode ourselves
        )
    except subprocess.TimeoutExpired:
        print("ERROR: branch-guard check timed out (gh took >15s). Cannot verify source integrity.")
        print("  Fix: ensure the gh CLI can reach github.com, then re-run.")
        sys.exit(1)
    except FileNotFoundError:
        print("ERROR: gh CLI not found. Cannot verify branch-guard on main.")
        print("  Fix: install the GitHub CLI (https://cli.github.com/) and authenticate.")
        sys.exit(1)

    # gh exited non-zero: auth expired, rate limit, API error, etc.
    # Any inability to get a definitive answer must block the pipeline — the
    # blast radius of writing unreviewed code to Firestore is too high.
    if result.returncode != 0:
        stderr = result.stderr.strip()
        detail = f"\n  Details: {stderr}" if stderr else ""
        print(f"ERROR: gh exited {result.returncode} querying branch-guard status.{detail}")
        print("  Fix: run 'gh auth status' and 're-authenticate if needed, then re-run.")
        sys.exit(1)

    conclusion = result.stdout.strip()

    if conclusion == "success":
        return

    if not conclusion:
        # No runs found — could be a new repo, or branch-guard was never triggered.
        # Fail closed: we cannot confirm the last commit was reviewed.
        print("ERROR: No branch-guard runs found on main. Cannot confirm source integrity.")
        print("  Fix: push a commit to main via a merged PR to trigger branch-guard, then re-run.")
        sys.exit(1)

    # Known non-success conclusion ("failure", "cancelled", "skipped", etc.):
    # an actual branch-guard violation.
    print(f"ERROR: branch-guard.yml last run on main is '{conclusion}', not 'success'.")
    print("  A direct push to main may have bypassed PR review.")
    print("  Check: https://github.com/Anguijm/city-atlas-service/actions/workflows/branch-guard.yml")
    print("  Re-run the workflow on main, or resolve the offending commit before writing to Firestore.")
    sys.exit(1)
