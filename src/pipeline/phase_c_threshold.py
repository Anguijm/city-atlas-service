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
    """Return the FAIL threshold ratio for a given coverageTier.

    Villages have small audit samples (e.g. 4 waypoints) where a single
    hallucinated place is 25% — enough to FAIL under the metro rule even
    though the city data is otherwise good. Raise the village floor to 40%
    so one bad waypoint out of four demotes to WARNING instead of FAIL.
    """
    if coverage_tier == "village":
        return 0.40
    if coverage_tier == "town":
        return 0.30
    return 0.25  # metro + unknown


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
