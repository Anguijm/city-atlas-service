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
# check_branch_guard — fail-closed: only "success" passes
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
            with pytest.raises(SystemExit) as exc_info:
                check_branch_guard()
        assert exc_info.value.code == 1

    def test_empty_stdout_exits(self):
        """No runs found → fail closed."""
        with patch("pipeline_utils.subprocess.run", return_value=_make_run_result(0, "")):
            with pytest.raises(SystemExit) as exc_info:
                check_branch_guard()
        assert exc_info.value.code == 1

    def test_empty_stdout_error_message(self, capsys):
        """No runs found → informative error message."""
        with patch("pipeline_utils.subprocess.run", return_value=_make_run_result(0, "")):
            with pytest.raises(SystemExit):
                check_branch_guard()
        out = capsys.readouterr().out
        assert "ERROR" in out
        assert "No branch-guard runs" in out

    def test_nonzero_returncode_exits(self):
        """gh exits non-zero (auth error, rate limit) → fail closed."""
        with patch("pipeline_utils.subprocess.run",
                   return_value=_make_run_result(1, "", "authentication required")):
            with pytest.raises(SystemExit) as exc_info:
                check_branch_guard()
        assert exc_info.value.code == 1

    def test_nonzero_returncode_includes_stderr(self, capsys):
        """Error message from gh is surfaced in the error output."""
        with patch("pipeline_utils.subprocess.run",
                   return_value=_make_run_result(1, "", "HTTP 403 Forbidden")):
            with pytest.raises(SystemExit):
                check_branch_guard()
        out = capsys.readouterr().out
        assert "HTTP 403 Forbidden" in out

    def test_timeout_exits(self):
        """gh times out → fail closed."""
        with patch("pipeline_utils.subprocess.run", side_effect=subprocess.TimeoutExpired("gh", 15)):
            with pytest.raises(SystemExit) as exc_info:
                check_branch_guard()
        assert exc_info.value.code == 1

    def test_file_not_found_exits(self):
        """gh not installed → fail closed."""
        with patch("pipeline_utils.subprocess.run", side_effect=FileNotFoundError):
            with pytest.raises(SystemExit) as exc_info:
                check_branch_guard()
        assert exc_info.value.code == 1
