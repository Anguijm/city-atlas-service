from batch_research import _redact_paths, PROJECT_ROOT


def test_redacts_the_project_root_and_home_directories():
    text = f"✓ Report saved: {PROJECT_ROOT}/data/research-output/x.md\\nTraceback: /home/someone/.local/lib/x.py and /Users/else/y.py"
    out = _redact_paths(text)
    assert str(PROJECT_ROOT) not in out
    assert "/home/someone" not in out and "/Users/else" not in out
    assert "./data/research-output/x.md" in out and "~/.local/lib/x.py" in out
