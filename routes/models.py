from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api")


class ModelListRequest(BaseModel):
    provider: str = Field(default="openai")
    apiKey: str | None = None
    apiUrl: str | None = None


def normalize_api_url(raw_url: str) -> str:
    value = (raw_url or "").strip()
    if not value:
        return ""
    if "://" not in value:
        value = f"https://{value}"
    return value


def build_models_base_url(raw_url: str, provider_mode: str) -> str:
    normalized = normalize_api_url(raw_url)
    if not normalized:
        return (
            "https://api.anthropic.com/v1"
            if provider_mode == "anthropic"
            else "https://api.openai.com/v1"
        )

    parsed = urlparse(normalized)
    if not parsed.scheme or not parsed.netloc:
        raise HTTPException(status_code=400, detail="无法解析 API 地址（用于获取模型列表）")

    path = (parsed.path or "").rstrip("/")
    path_lower = path.lower()
    v1_index = path_lower.find("/v1")
    if v1_index >= 0:
        base_path = path[: v1_index + 3]
    elif path_lower.endswith("/chat/completions"):
        base_path = path[: -len("/chat/completions")]
    elif path_lower.endswith("/messages"):
        base_path = path[: -len("/messages")]
    elif path_lower.endswith("/models"):
        base_path = path[: -len("/models")]
    else:
        base_path = path

    if not base_path:
        base_path = "/v1"
    elif not base_path.lower().endswith("/v1"):
        base_path = f"{base_path}/v1"

    return f"{parsed.scheme}://{parsed.netloc}{base_path}"


@router.post("/models/list")
async def list_models(payload: ModelListRequest):
    provider = (payload.provider or "openai").strip().lower()
    provider_mode = "anthropic" if provider == "anthropic" else "openai"

    base = build_models_base_url(payload.apiUrl or "", provider_mode)
    url = f"{base}/models"
    api_key = (payload.apiKey or "").strip()
    headers: dict[str, str] = {"anthropic-version": "2023-06-01"} if provider_mode == "anthropic" else {}
    if api_key:
        if provider_mode == "anthropic":
            headers["x-api-key"] = api_key
        else:
            headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=headers)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"模型列表请求失败: {e}") from e

    try:
        data = resp.json()
    except Exception:
        data = None

    if resp.status_code >= 400:
        detail = ""
        if isinstance(data, dict):
            err = data.get("error")
            if isinstance(err, dict) and isinstance(err.get("message"), str):
                detail = err["message"]
            elif isinstance(data.get("message"), str):
                detail = data["message"]
        if not detail:
            detail = resp.text or resp.reason_phrase or ""
        raise HTTPException(status_code=resp.status_code, detail=f"获取模型列表失败: {detail}")

    items = []
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        items = data["data"]
    elif isinstance(data, dict) and isinstance(data.get("models"), list):
        items = data["models"]
    elif isinstance(data, list):
        items = data

    model_ids: list[str] = []
    for item in items:
        if isinstance(item, dict):
            mid = (item.get("id") or item.get("name") or item.get("model") or "").strip()
            if mid:
                model_ids.append(mid)
        elif isinstance(item, str) and item.strip():
            model_ids.append(item.strip())

    model_ids = sorted(set(model_ids))
    if not model_ids:
        raise HTTPException(status_code=502, detail="获取到的模型列表为空或格式不支持")

    return {"models": model_ids}

