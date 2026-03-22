import json
import mimetypes
import re
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response

from config import BUILD_ID, DESKTOP_MODE, DESKTOP_RELEASE_MODE
from runtime_paths import frontend_path

mimetypes.init()
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/json", ".json")

router = APIRouter()

INDEX_HTML_PATH = frontend_path("index.html")
DEV_FRONTEND_ASSET_VERSION = str(time.time_ns())
NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}
IMMUTABLE_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=31536000, immutable",
}
REVALIDATE_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=0, must-revalidate",
}
LOCAL_JS_IMPORT_PATTERN = re.compile(
    r'(?P<prefix>\bimport\s+(?:[^"\']+?\s+from\s+)?|'
    r'\bexport\s+[^"\']*?\s+from\s+|'
    r'\bimport\s*\()'
    r'(?P<quote>["\'])'
    r'(?P<specifier>\.{1,2}/[^"\']+?\.js)'
    r'(?P=quote)'
)


def _should_disable_frontend_cache() -> bool:
    return not DESKTOP_RELEASE_MODE


def _get_frontend_asset_version() -> str:
    if _should_disable_frontend_cache():
        return DEV_FRONTEND_ASSET_VERSION
    return BUILD_ID


def _get_cache_headers(
    default_headers: dict[str, str] | None = None,
) -> dict[str, str]:
    if _should_disable_frontend_cache():
        return NO_CACHE_HEADERS
    return default_headers or IMMUTABLE_CACHE_HEADERS


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


def _serve_frontend_sub_asset(
    asset_dir: str,
    asset_path: str,
    label: str,
    headers: dict[str, str] | None = None,
) -> FileResponse:
    file_path = _resolve_frontend_sub_asset(asset_dir, asset_path, label)
    media_type, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(
        file_path,
        media_type=media_type,
        headers=_get_cache_headers(headers),
    )


def _append_build_id_to_local_js_imports(source: str) -> str:
    asset_version = _get_frontend_asset_version()

    def repl(match: re.Match[str]) -> str:
        specifier = match.group("specifier")
        separator = "&" if "?" in specifier else "?"
        versioned = f"{specifier}{separator}v={asset_version}"
        return f'{match.group("prefix")}{match.group("quote")}{versioned}{match.group("quote")}'

    return LOCAL_JS_IMPORT_PATTERN.sub(repl, source)


def _serve_versioned_js_asset(
    file_path: Path,
    headers: dict[str, str],
) -> Response:
    with open(file_path, "r", encoding="utf-8") as f:
        source = f.read()
    content = _append_build_id_to_local_js_imports(source)
    return Response(
        content=content,
        media_type="application/javascript",
        headers=headers,
    )


def _render_index_html() -> str:
    _ensure_frontend_asset(INDEX_HTML_PATH, "主页")
    with open(INDEX_HTML_PATH, "r", encoding="utf-8") as f:
        html = f.read()
    asset_version = _get_frontend_asset_version()
    runtime_payload = {
        "platform": "desktop" if DESKTOP_MODE else "web",
    }
    runtime_json = json.dumps(runtime_payload, ensure_ascii=False).replace("</", "<\\/")
    runtime_script = (
        "<script>"
        "window.__PRISM_RUNTIME__ = Object.assign("
        "window.__PRISM_RUNTIME__ || {}, "
        f"{runtime_json}"
        ");"
        "</script>"
    )
    html = html.replace("</head>", f"{runtime_script}\n  </head>", 1)
    html = re.sub(
        r'(href|src)="((?:css|js|libs|styles|app)/[^"?]+|style\.css|app\.js|favicon\.svg)(?:\?[^"]*)?"',
        lambda match: f'{match.group(1)}="{match.group(2)}?v={asset_version}"',
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
        headers=_get_cache_headers(REVALIDATE_CACHE_HEADERS),
    )


@router.get("/app.js")
async def serve_app():
    app_path = frontend_path("app.js")
    _ensure_frontend_asset(app_path, "脚本文件")
    return _serve_versioned_js_asset(
        app_path,
        headers=_get_cache_headers(REVALIDATE_CACHE_HEADERS),
    )


@router.get("/favicon.svg")
async def serve_favicon_svg():
    favicon_path = frontend_path("favicon.svg")
    _ensure_frontend_asset(favicon_path, "站点图标")
    return FileResponse(favicon_path, headers=_get_cache_headers())


@router.get("/favicon.ico")
async def serve_favicon_ico():
    favicon_path = frontend_path("favicon.svg")
    _ensure_frontend_asset(favicon_path, "站点图标")
    return FileResponse(
        favicon_path,
        media_type="image/svg+xml",
        headers=_get_cache_headers(),
    )


@router.get("/js/{asset_path:path}")
async def serve_js_asset(asset_path: str):
    file_path = _resolve_frontend_sub_asset("js", asset_path, "脚本文件")
    return _serve_versioned_js_asset(
        file_path,
        headers=_get_cache_headers(REVALIDATE_CACHE_HEADERS),
    )


@router.get("/css/{asset_path:path}")
async def serve_css_asset(asset_path: str):
    return _serve_frontend_sub_asset(
        "css",
        asset_path,
        "样式文件",
        headers=_get_cache_headers(REVALIDATE_CACHE_HEADERS),
    )


@router.get("/libs/{asset_path:path}")
async def serve_lib_asset(asset_path: str):
    return _serve_frontend_sub_asset(
        "libs",
        asset_path,
        "依赖文件",
    )


@router.get("/styles/{asset_path:path}")
async def serve_styles_asset(asset_path: str):
    return _serve_frontend_sub_asset(
        "styles",
        asset_path,
        "样式文件",
        headers=_get_cache_headers(REVALIDATE_CACHE_HEADERS),
    )


@router.get("/app/{asset_path:path}")
async def serve_app_asset(asset_path: str):
    file_path = _resolve_frontend_sub_asset("app", asset_path, "应用文件")
    return _serve_versioned_js_asset(
        file_path,
        headers=_get_cache_headers(REVALIDATE_CACHE_HEADERS),
    )
