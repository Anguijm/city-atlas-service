"""Tests for Phase C proportional FAIL threshold.

The previous behavior used an absolute "3+ hallucinations = FAIL" rule
(baked into the Gemini prompt). That was too strict for small enrichment
deltas where Gemini would flag 3+ items out of a 15-item sample and the
city would be moved to failed/, even though 3/15 = 20% is well within
tolerance for a walking app.

The new rule is proportional: FAIL only if hallucinated_count / sample_size
is strictly greater than 25% of the audit sample. Otherwise the verdict is
demoted to WARNING so the existing hallucination-removal path can clean up
the bad places without losing the whole city.
"""

from phase_c_threshold import apply_proportional_fail_threshold


class TestPassThrough:
    def test_pass_verdict_is_unchanged(self):
        status, reason = apply_proportional_fail_threshold("PASS", 0, 15)
        assert status == "PASS"
        assert reason is None

    def test_warning_verdict_is_unchanged(self):
        status, reason = apply_proportional_fail_threshold("WARNING", 2, 15)
        assert status == "WARNING"
        assert reason is None

    def test_warning_verdict_is_unchanged_even_with_many_hallucinations(self):
        # The helper only *demotes* FAIL. It never escalates WARNING.
        status, reason = apply_proportional_fail_threshold("WARNING", 10, 15)
        assert status == "WARNING"
        assert reason is None


class TestFailDemotion:
    def test_fail_with_3_of_15_is_demoted_to_warning(self):
        # 3/15 = 20% — the exact case that was wrongly failing 19 cities
        # in the enrichment batch. Should become WARNING.
        status, reason = apply_proportional_fail_threshold("FAIL", 3, 15)
        assert status == "WARNING"
        assert reason is not None
        assert "20%" in reason

    def test_fail_with_2_of_10_is_demoted_to_warning(self):
        # 2/10 = 20% — below 25% threshold, demote.
        status, reason = apply_proportional_fail_threshold("FAIL", 2, 10)
        assert status == "WARNING"
        assert reason is not None

    def test_fail_with_1_of_5_is_demoted_to_warning(self):
        # 1/5 = 20% — below 25% threshold, demote.
        status, reason = apply_proportional_fail_threshold("FAIL", 1, 5)
        assert status == "WARNING"
        assert reason is not None

    def test_fail_at_exactly_25_percent_is_demoted(self):
        # 25% is NOT strictly greater than 25%, so demote.
        status, reason = apply_proportional_fail_threshold("FAIL", 1, 4)
        assert status == "WARNING"
        assert reason is not None


class TestFailPreserved:
    def test_fail_with_4_of_15_is_preserved(self):
        # 4/15 = 26.6% — strictly greater than 25%, keep FAIL.
        status, reason = apply_proportional_fail_threshold("FAIL", 4, 15)
        assert status == "FAIL"
        assert reason is None

    def test_fail_with_3_of_10_is_preserved(self):
        # 3/10 = 30% — strictly greater than 25%, keep FAIL.
        status, reason = apply_proportional_fail_threshold("FAIL", 3, 10)
        assert status == "FAIL"
        assert reason is None

    def test_fail_with_majority_hallucinations_is_preserved(self):
        status, reason = apply_proportional_fail_threshold("FAIL", 10, 15)
        assert status == "FAIL"
        assert reason is None


class TestEdgeCases:
    def test_fail_with_zero_sample_is_preserved(self):
        # Can't compute a ratio with zero sample — keep FAIL for safety.
        # This path indicates the sampler found no waypoints to audit,
        # which is itself a signal something is very wrong.
        status, reason = apply_proportional_fail_threshold("FAIL", 0, 0)
        assert status == "FAIL"
        assert reason is None

    def test_fail_with_zero_hallucinations_is_demoted(self):
        # Gemini said FAIL but extraction found 0 matching hallucinated
        # names. Ratio is 0, below threshold — demote to WARNING.
        # The hallucination-removal path will be a no-op and the city
        # will survive on coverage metrics alone.
        status, reason = apply_proportional_fail_threshold("FAIL", 0, 15)
        assert status == "WARNING"
        assert reason is not None

    def test_custom_threshold_ratio_is_respected(self):
        # Override the default 25% threshold for callers that want to
        # be stricter (e.g., baseline research vs. enrichment).
        status, reason = apply_proportional_fail_threshold(
            "FAIL", 2, 15, threshold_ratio=0.10
        )
        # 2/15 = 13.3% > 10% → keep FAIL
        assert status == "FAIL"
        assert reason is None

    def test_negative_sample_is_preserved_as_fail(self):
        # Defensive: malformed input should not silently demote.
        status, reason = apply_proportional_fail_threshold("FAIL", 3, -1)
        assert status == "FAIL"
        assert reason is None


class TestReasonMessageFormat:
    def test_demotion_reason_includes_counts(self):
        _, reason = apply_proportional_fail_threshold("FAIL", 3, 15)
        assert "3" in reason
        assert "15" in reason

    def test_demotion_reason_includes_threshold(self):
        _, reason = apply_proportional_fail_threshold("FAIL", 3, 15)
        assert "25%" in reason
