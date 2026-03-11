import mimetypes
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

from config import BUILD_ID
from runtime_paths import frontend_path

mimetypes.init()
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".json")

router = APIRouter()

INDEX_HTML_PATH = frontend_path("index.html")
NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}
IMMUTABLE_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=31536000, immutable",
}


def _ensure_frontend_asset(path, label: str) -> None:
    if path.exists():
        return
    raise HTTPException(
        status_code=404,
        detail=f"{label} 不可用：当前运行模式未携带前端静态资源",
    )


def _resolve_frontend_sub_asset(asset_dir: str, asset_path: str, label: str) -> Path:
    base_dir = frontend_path(asset_dir).resolve()
    candidate = base_dir.joinpath(asset_path).resolve()
    try:
        candidate.relative_to(base_dir)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=f"{label} 不存在") from exc

    if not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"{label} 不存在")
    return candidate


def _serve_frontend_sub_asset(asset_dir: str, asset_path: str, label: str) -> FileResponse:
    file_path = _resolve_frontend_sub_asset(asset_dir, asset_path, label)
    media_type, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(
        file_path,
        media_type=media_type,
        headers=IMMUTABLE_CACHE_HEADERS,
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
        headers=IMMUTABLE_CACHE_HEADERS,
    )


@router.get("/app.js")
async def serve_app():
    app_path = frontend_path("app.js")
    _ensure_frontend_asset(app_path, "脚本文件")
    return FileResponse(
        app_path,
        headers=IMMUTABLE_CACHE_HEADERS,
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


@router.get("/js/{asset_path:path}")
async def serve_js_asset(asset_path: str):
    return _serve_frontend_sub_asset("js", asset_path, "脚本文件")


@router.get("/css/{asset_path:path}")
async def serve_css_asset(asset_path: str):
    return _serve_frontend_sub_asset("css", asset_path, "样式文件")


@router.get("/libs/{asset_path:path}")
async def serve_lib_asset(asset_path: str):
    return _serve_frontend_sub_asset("libs", asset_path, "依赖文件")


@router.get("/styles/{asset_path:path}")
async def serve_styles_asset(asset_path: str):
    return _serve_frontend_sub_asset("styles", asset_path, "样式文件")


@router.get("/app/{asset_path:path}")
async def serve_app_asset(asset_path: str):
    return _serve_frontend_sub_asset("app", asset_path, "应用文件")

