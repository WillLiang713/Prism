from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai import ProviderConfig
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
        if provider_mode == "gemini":
            return "https://generativelanguage.googleapis.com/v1beta"
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
    if provider_mode == "gemini":
        models_index = path_lower.find("/models/")
        if models_index >= 0:
            base_path = path[:models_index]
        elif path_lower.endswith("/models"):
            base_path = path[: -len("/models")]
        elif ":generatecontent" in path_lower:
            base_path = path.split(":", 1)[0]
            if "/models/" in base_path.lower():
                base_path = base_path[: base_path.lower().find("/models/")]
        elif path_lower.endswith("/v1beta") or path_lower.endswith("/v1"):
            base_path = path
        else:
            base_path = path

        if not base_path:
            base_path = "/v1beta"
        elif not base_path.lower().endswith("/v1beta") and not base_path.lower().endswith("/v1"):
            base_path = f"{base_path}/v1beta"
    else:
        v1_index = path_lower.find("/v1")
        if v1_index >= 0:
            base_path = path[: v1_index + 3]
        elif path_lower.endswith("/chat/completions"):
            base_path = path[: -len("/chat/completions")]
        elif path_lower.endswith("/responses"):
            base_path = path[: -len("/responses")]
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


def build_models_candidate_urls(raw_url: str, provider_mode: str) -> list[str]:
    base = build_models_base_url(raw_url, provider_mode).rstrip("/")
    candidates = [f"{base}/models"]

    if provider_mode != "gemini":
        return candidates

    lowered = base.lower()
    alternate_base = ""
    if lowered.endswith("/v1beta"):
        alternate_base = f"{base[:-len('/v1beta')]}/v1"
    elif lowered.endswith("/v1"):
        alternate_base = f"{base[:-len('/v1')]}/v1beta"

    alternate = alternate_base.rstrip("/")
    if alternate:
        alt_url = f"{alternate}/models"
        if alt_url not in candidates:
            candidates.append(alt_url)

    return candidates


@router.post("/models/list")
async def list_models(payload: ModelListRequest):
    provider = (payload.provider or "openai").strip().lower()
    provider_mode = ProviderConfig.get_provider_mode(provider)
    api_key = (payload.apiKey or "").strip()

    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 API Key")

    headers = ProviderConfig.build_headers(api_key, provider_mode)
    if provider_mode != "anthropic":
        headers.pop("anthropic-version", None)

    last_status = 502
    last_detail = "获取模型列表失败"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            for url in build_models_candidate_urls(str(payload.apiUrl or ""), provider_mode):
                resp = await client.get(url, headers=headers)

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
                    last_status = resp.status_code
                    last_detail = detail
                    continue

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
                        if provider_mode == "gemini" and mid.startswith("models/"):
                            mid = mid[len("models/") :]
                        if mid:
                            model_ids.append(mid)
                    elif isinstance(item, str) and item.strip():
                        mid = item.strip()
                        if provider_mode == "gemini" and mid.startswith("models/"):
                            mid = mid[len("models/") :]
                        model_ids.append(mid)

                model_ids = sorted(set(model_ids))
                if model_ids:
                    return {"models": model_ids}

                last_status = 502
                last_detail = "获取到的模型列表为空或格式不支持"
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"模型列表请求失败: {e}") from e

    raise HTTPException(status_code=last_status, detail=f"获取模型列表失败: {last_detail}")
