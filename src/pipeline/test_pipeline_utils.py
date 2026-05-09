"""Unit tests for pipeline_utils.py."""

import subprocess
import sys
from unittest.mock import MagicMock, patch

import pytest

from pipeline_utils import CITY_ID_RE, check_branch_guard


# ---------------------------------------------------------------------------
# CITY_ID_RE
# ---------------------------------------------------------------------------

class TestCityIdRe:
    def test_accepts_simple_slug(self):
        assert CITY_ID_RE.match("new-york-city")

    def test_accepts_digits(self):
        assert CITY_ID_RE.match("city123")

    def test_accepts_single_word(self):
        assert CITY_ID_RE.match("paris")

    def test_rejects_uppercase(self):
        assert not CITY_ID_RE.match("New-York")

    def test_rejects_slash(self):
        assert not CITY_ID_RE.match("../etc/passwd")

    def test_rejects_dot(self):
        assert not CITY_ID_RE.match("city.name")

    def test_rejects_space(self):
        assert not CITY_ID_RE.match("new york")

    def test_rejects_empty(self):
        assert not CITY_ID_RE.match("")

    def test_rejects_semicolon(self):
        assert not CITY_ID_RE.match("city;rm -rf /")


# ---------------------------------------------------------------------------
# check_branch_guard
# ---------------------------------------------------------------------------

def _make_run_result(returncode: int, stdout: str, stderr: str = "") -> MagicMock:
    r = MagicMock()
    r.returncode = returncode
    r.stdout = stdout
    r.stderr = stderr
    return r


class TestCheckBranchGuard:
    def test_success_returns_silently(self):
        """Green branch-guard → no output, no exit."""
        with patch("pipeline_utils.subprocess.run", return_value=_make_run_result(0, "success\n")):
            check_branch_guard()  # must not raise or exit

    def test_failure_conclusion_exits(self):
        """Known non-success conclusion → sys.exit(1)."""
        with patch("pipeline_utils.subprocess.run", return_value=_make_run_result(0, "failure\n")):
            with pytest.raises(SystemExit) as exc_info:
                check_branch_guard()
        assert exc_info.value.code == 1

    def test_cancelled_conclusion_exits(self):
        with patch("pipeline_utils.subprocess.run", return_value=_make_run_result(0, "cancelled\n")):
            with pytest.raises(SystemExit):
                check_branch_guard()

    def test_empty_stdout_warns_and_proceeds(self, capsys):
        """No runs found → warn, don't exit."""
        with patch("pipeline_utils.subprocess.run", return_value=_make_run_result(0, "")):
            check_branch_guard()
        out = capsys.readouterr().out
        assert "WARNING" in out
        assert "No branch-guard runs" in out

    def test_nonzero_returncode_warns_and_proceeds(self, capsys):
        """gh exits non-zero (auth error, rate limit) → warn, don't exit."""
        with patch("pipeline_utils.subprocess.run",
                   return_value=_make_run_result(1, "", "authentication required")):
            check_branch_guard()
        out = capsys.readouterr().out
        assert "WARNING" in out
        assert "gh exited 1" in out

    def test_timeout_warns_and_proceeds(self, capsys):
        """gh times out → warn, don't exit."""
        with patch("pipeline_utils.subprocess.run", side_effect=subprocess.TimeoutExpired("gh", 15)):
            check_branch_guard()
        out = capsys.readouterr().out
        assert "WARNING" in out
        assert "timed out" in out

    def test_file_not_found_warns_and_proceeds(self, capsys):
        """gh not installed → warn, don't exit."""
        with patch("pipeline_utils.subprocess.run", side_effect=FileNotFoundError):
            check_branch_guard()
        out = capsys.readouterr().out
        assert "WARNING" in out

    def test_nonzero_returncode_includes_stderr(self, capsys):
        """Error message from gh is surfaced in the warning."""
        with patch("pipeline_utils.subprocess.run",
                   return_value=_make_run_result(1, "", "HTTP 403 Forbidden")):
            check_branch_guard()
        out = capsys.readouterr().out
        assert "HTTP 403 Forbidden" in out
