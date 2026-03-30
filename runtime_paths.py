from __future__ import annotations

import os
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parent


def get_resource_root() -> Path:
    """返回运行时资源根目录，兼容冻结后的目录式发布。"""
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


def desktop_logs_dir(app_name: str = "Prism") -> Path:
    """返回桌面端日志目录，优先写入用户本地应用数据目录。"""
    local_appdata = (os.getenv("LOCALAPPDATA") or os.getenv("APPDATA") or "").strip()
    if local_appdata:
        return Path(local_appdata) / app_name / "logs"
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "logs"
    return PROJECT_ROOT / "logs"
