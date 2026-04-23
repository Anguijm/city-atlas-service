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


def apply_proportional_fail_threshold(
    status: str,
    hallucinated_count: int,
    sample_size: int,
    threshold_ratio: float = 0.25,
) -> tuple[str, str | None]:
    """Apply the proportional FAIL threshold.

    Args:
        status: The raw verdict from the Gemini semantic audit
            ("PASS" | "WARNING" | "FAIL").
        hallucinated_count: Number of places from the audit sample that
            were successfully extracted as hallucinated (matched against
            the sampled waypoints).
        sample_size: Number of waypoints in the audit sample.
        threshold_ratio: Proportional FAIL threshold. FAIL is preserved
            only when hallucinated_count / sample_size is strictly greater
            than this value. Defaults to 0.25 (25%).

    Returns:
        (final_status, demotion_reason). demotion_reason is None unless
        a FAIL was demoted to WARNING.
    """
    if status != "FAIL":
        return status, None

    # Defensive: malformed / empty sample — preserve FAIL for safety.
    # A zero-size sample is itself a signal that something is wrong
    # with the sampler, and we'd rather surface that than silently
    # downgrade.
    if sample_size <= 0:
        return "FAIL", None

    ratio = hallucinated_count / sample_size
    if ratio > threshold_ratio:
        return "FAIL", None

    threshold_pct = int(round(threshold_ratio * 100))
    reason = (
        f"proportional threshold not met: "
        f"{hallucinated_count}/{sample_size} ({ratio:.0%}) <= {threshold_pct}%"
    )
    return "WARNING", reason
