import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

from config import BUILD_ID
from runtime_paths import frontend_path


router = APIRouter()

INDEX_HTML_PATH = frontend_path("index.html")
NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _ensure_frontend_asset(path, label: str) -> None:
    if path.exists():
        return
    raise HTTPException(
        status_code=404,
        detail=f"{label} 不可用：当前运行模式未携带前端静态资源",
    )


def _render_index_html() -> str:
    _ensure_frontend_asset(INDEX_HTML_PATH, "主页")
    with open(INDEX_HTML_PATH, "r", encoding="utf-8") as f:
        html = f.read()
    html = re.sub(
        r'(href|src)="((?:css|js|libs|styles|app)/[^"?]+|style\.css|app\.js|favicon\.svg)(?:\?[^"]*)?"',
        lambda match: f'{match.group(1)}="{match.group(2)}?v={BUILD_ID}"',
        html,
    )
    return html


@router.get("/")
async def serve_index():
    return HTMLResponse(_render_index_html(), headers=NO_CACHE_HEADERS)


@router.get("/index.html")
async def serve_index_html():
    return HTMLResponse(_render_index_html(), headers=NO_CACHE_HEADERS)


@router.get("/style.css")
async def serve_style():
    style_path = frontend_path("style.css")
    _ensure_frontend_asset(style_path, "样式文件")
    return FileResponse(
        style_path,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/app.js")
async def serve_app():
    app_path = frontend_path("app.js")
    _ensure_frontend_asset(app_path, "脚本文件")
    return FileResponse(
        app_path,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.get("/favicon.svg")
async def serve_favicon_svg():
    favicon_path = frontend_path("favicon.svg")
    _ensure_frontend_asset(favicon_path, "站点图标")
    return FileResponse(favicon_path)


@router.get("/favicon.ico")
async def serve_favicon_ico():
    favicon_path = frontend_path("favicon.svg")
    _ensure_frontend_asset(favicon_path, "站点图标")
    return FileResponse(favicon_path, media_type="image/svg+xml")

