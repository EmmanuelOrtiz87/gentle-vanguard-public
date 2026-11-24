"""Basic smoke tests for generate-from-template.py structure"""

from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent.parent / "skills" / "fireworks-tech-graph"
SCRIPT_PATH = SKILL_DIR / "scripts" / "generate-from-template.py"
TEMPLATE_DIR = SKILL_DIR / "templates"


def test_script_exists():
    assert SCRIPT_PATH.is_file(), f"Script not found at {SCRIPT_PATH}"
    assert SCRIPT_PATH.stat().st_size > 1000


def test_templates_exist():
    if TEMPLATE_DIR.is_dir():
        templates = list(TEMPLATE_DIR.glob("**/*.svg"))
        assert len(templates) > 0, f"No SVG templates in {TEMPLATE_DIR}"


def test_script_contains_key_constants():
    content = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "DEFAULT_VIEWBOX" in content
    assert "SCRIPT_DIR" in content
    assert "TEMPLATE_DIR" in content
    assert "def main" in content
