from __future__ import annotations

from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parent


def get_resource_root() -> Path:
    """返回运行时资源根目录，兼容 PyInstaller one-file。"""
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", "")
        if meipass:
            return Path(meipass)
        return Path(sys.executable).resolve().parent
    return PROJECT_ROOT


RESOURCE_ROOT = get_resource_root()
FRONTEND_DIR = RESOURCE_ROOT / "frontend"
TOOLS_JSON_PATH = RESOURCE_ROOT / "tools.json"


def frontend_path(*parts: str) -> Path:
    return FRONTEND_DIR.joinpath(*parts)


def has_frontend_assets() -> bool:
    return frontend_path("index.html").exists()
