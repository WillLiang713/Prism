import threading
import time
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel


router = APIRouter(prefix="/api/html-preview", tags=["html-preview"])

PREVIEW_TTL_SECONDS = 15 * 60
MAX_PREVIEW_SESSIONS = 64
PREVIEW_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


@dataclass(slots=True)
class PreviewSession:
    document: str
    created_at: float


class CreatePreviewSessionRequest(BaseModel):
    document: str


_preview_sessions: dict[str, PreviewSession] = {}
_preview_sessions_lock = threading.Lock()


def _cleanup_expired_sessions(now: float | None = None) -> None:
    current_time = now if now is not None else time.time()
    expired_ids = [
        session_id
        for session_id, session in _preview_sessions.items()
        if current_time - session.created_at > PREVIEW_TTL_SECONDS
    ]
    for session_id in expired_ids:
        _preview_sessions.pop(session_id, None)


def _get_preview_session_or_404(session_id: str) -> PreviewSession:
    normalized_session_id = str(session_id or "").strip()
    if not normalized_session_id:
        raise HTTPException(status_code=404, detail="预览内容不存在")

    current_time = time.time()
    with _preview_sessions_lock:
        _cleanup_expired_sessions(current_time)
        session = _preview_sessions.get(normalized_session_id)

    if not session:
        raise HTTPException(status_code=404, detail="预览内容不存在或已过期")

    return session


@router.post("/sessions")
async def create_preview_session(request: CreatePreviewSessionRequest):
    document = str(request.document or "")
    if not document.strip():
        raise HTTPException(status_code=400, detail="预览内容不能为空")

    current_time = time.time()
    session_id = uuid.uuid4().hex

    with _preview_sessions_lock:
        _cleanup_expired_sessions(current_time)
        if len(_preview_sessions) >= MAX_PREVIEW_SESSIONS:
            oldest_session_id = min(
                _preview_sessions.items(),
                key=lambda item: item[1].created_at,
            )[0]
            _preview_sessions.pop(oldest_session_id, None)

        _preview_sessions[session_id] = PreviewSession(
            document=document,
            created_at=current_time,
        )

    return {
        "id": session_id,
        "url": f"/api/html-preview/content/{session_id}",
        "expiresIn": PREVIEW_TTL_SECONDS,
    }


@router.get("/content/{session_id}")
async def get_preview_content(session_id: str):
    session = _get_preview_session_or_404(session_id)
    return HTMLResponse(
        content=session.document,
        headers=PREVIEW_CACHE_HEADERS,
    )


@router.get("/page/{session_id}")
async def get_preview_page(session_id: str):
    session = _get_preview_session_or_404(session_id)
    return HTMLResponse(
        content=session.document,
        headers=PREVIEW_CACHE_HEADERS,
    )
