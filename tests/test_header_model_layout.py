from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
HEADER_CSS = ROOT / "frontend" / "css" / "header.css"
RESPONSIVE_CSS = ROOT / "frontend" / "css" / "responsive.css"


def _get_css_block(path: Path, selector: str) -> str:
    css = path.read_text(encoding="utf-8")
    pattern = re.compile(rf"{re.escape(selector)}\s*\{{(?P<body>.*?)\n\}}", re.S)
    match = pattern.search(css)
    assert match, f"Missing selector block: {selector} in {path.name}"
    return match.group("body")


def test_brand_model_container_can_shrink_for_long_model_ids():
    block = _get_css_block(HEADER_CSS, ".brand-model")

    assert "min-width: 0;" in block
    assert "max-width: 100%;" in block
    assert "overflow: hidden;" in block
    assert "flex-shrink: 1;" in block or "flex: 1 1 auto;" in block



def test_brand_model_trigger_is_capped_by_available_header_width():
    block = _get_css_block(HEADER_CSS, ".brand-model-trigger")

    assert "max-width: min(100%, 320px);" in block
    assert "overflow: hidden;" in block



def test_header_brand_reserves_side_space_for_top_actions():
    block = _get_css_block(HEADER_CSS, ".header-brand")

    assert "width: min(calc(100% - 360px), 680px);" in block



def test_responsive_header_brand_keeps_explicit_width_cap():
    block = _get_css_block(RESPONSIVE_CSS, ".header-brand")

    assert "grid-column: 2;" in block
    assert "position: relative;" in block
    assert "left: auto;" in block
    assert "top: auto;" in block
    assert "transform: none;" in block
    assert "width: 100%;" in block
    assert "max-width: 100%;" in block


def test_responsive_header_model_trigger_uses_mobile_safe_cap():
    block = _get_css_block(RESPONSIVE_CSS, ".header-brand .brand-model-trigger")

    assert "max-width: min(100%, 180px);" in block
