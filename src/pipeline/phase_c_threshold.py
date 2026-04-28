"""Phase C FAIL threshold helper.

Replaces the absolute "3+ hallucinations = FAIL" rule with a proportional
threshold so the audit scales with sample size.

Context: the enrichment batch on 2026-04-08 had 19/135 cities (14%) fail
Phase C because Gemini flagged 3+ places as hallucinated in a 15-item
audit sample. 3/15 = 20%, which is well within tolerance for a walking
app — the previous rule was an absolute count baked into the Gemini prompt
and inherited here by trusting the verdict verbatim.

The new rule: FAIL only if hallucinated_count / sample_size is strictly
greater than 25%. Otherwise the verdict is demoted to WARNING so the
existing hallucination-removal pathway can strip the bad places and
preserve the city's enrichment data.
"""

from __future__ import annotations


def _threshold_for_tier(coverage_tier: str | None) -> float:
    """Return the proportional FAIL threshold for a given coverageTier.

    WHY tiered thresholds instead of a single 25% rule:
    The hallucinated_count / sample_size ratio is sensitive to sample size.
    With metro cities (audit sample ~15 waypoints), 1 hallucination = 6.7%,
    which is comfortably below 25%. But village audit samples are typically
    4–6 waypoints — a single hallucinated place hits 20–25%, triggering FAIL
    even though one bad waypoint out of four is within reasonable tolerance
    for a walking app that already strips hallucinations via the cleanup path.

    WHY 0.40 for villages:
      Worst realistic case: 4-waypoint audit, 1 hallucinated = 25%.
      We want 1/4 to be WARNING (cleanable), not FAIL (city discarded).
      2/4 = 50% > 40% → stays FAIL. So the 40% threshold accepts 1 bad
      waypoint in 4 but still rejects 2+ bad waypoints in 4.

    WHY 0.30 for towns:
      Town audit samples are typically 8–12 waypoints. 2/8 = 25% is the
      boundary case. Raising the town threshold to 30% means 2/8 demotes
      to WARNING while 3/8 = 37.5% > 30% stays FAIL. This mirrors the
      village logic but at the size scale of town enrichment runs.

    WHY 0.25 for metro (unchanged from the original single-threshold rule):
      Metro audit samples of ~15 waypoints have enough data points that 25%
      is a meaningful signal. 4/15 = 26.7% → FAIL; 3/15 = 20% → WARNING.
      This is the same rule that previously applied to all tiers.

    Changing these: update test_phase_c_threshold.py::TestTierAwareThreshold
    and verify the math examples in this docstring still hold.
    """
    if coverage_tier == "village":
        return 0.40  # 1/4 waypoints hallucinated → WARNING; 2/4 → FAIL
    if coverage_tier == "town":
        return 0.30  # 2/8 waypoints hallucinated → WARNING; 3/8 → FAIL
    return 0.25      # metro + unknown: original rule, unchanged


def apply_proportional_fail_threshold(
    status: str,
    hallucinated_count: int,
    sample_size: int,
    threshold_ratio: float | None = None,
    coverage_tier: str | None = None,
) -> tuple[str, str | None]:
    """Apply the proportional FAIL threshold.

    Args:
        status: The raw verdict from the Gemini semantic audit
            ("PASS" | "WARNING" | "FAIL").
        hallucinated_count: Number of places from the audit sample that
            were successfully extracted as hallucinated (matched against
            the sampled waypoints).
        sample_size: Number of waypoints in the audit sample.
        threshold_ratio: Explicit proportional FAIL threshold. If omitted,
            derived from coverage_tier via _threshold_for_tier().
        coverage_tier: City coverageTier ("metro" | "town" | "village").
            Used to select the default threshold when threshold_ratio is None.

    Returns:
        (final_status, demotion_reason). demotion_reason is None unless
        a FAIL was demoted to WARNING.
    """
    if status != "FAIL":
        return status, None

    # Defensive: malformed / empty sample — preserve FAIL for safety.
    if sample_size <= 0:
        return "FAIL", None

    if threshold_ratio is None:
        threshold_ratio = _threshold_for_tier(coverage_tier)

    ratio = hallucinated_count / sample_size
    if ratio > threshold_ratio:
        return "FAIL", None

    threshold_pct = int(round(threshold_ratio * 100))
    reason = (
        f"proportional threshold not met: "
        f"{hallucinated_count}/{sample_size} ({ratio:.0%}) <= {threshold_pct}%"
    )
    return "WARNING", reason
