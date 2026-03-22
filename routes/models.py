from typing import Any
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
    model: str | None = None


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


def build_model_list_header_variants(
    api_key: str,
    provider_mode: str,
) -> list[dict[str, str]]:
    headers = ProviderConfig.build_headers(api_key, provider_mode)
    if provider_mode != "anthropic":
        headers.pop("anthropic-version", None)
        return [headers]

    variants = [
        headers,
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "anthropic-version": headers.get("anthropic-version", "2023-06-01"),
        },
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    ]

    deduped: list[dict[str, str]] = []
    seen: set[tuple[tuple[str, str], ...]] = set()
    for variant in variants:
        identity = tuple(sorted(variant.items()))
        if identity in seen:
            continue
        seen.add(identity)
        deduped.append(variant)
    return deduped


def extract_error_detail(response: httpx.Response, data: Any) -> str:
    detail = ""
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            detail = err["message"]
        elif isinstance(data.get("message"), str):
            detail = data["message"]
        elif isinstance(err, str):
            detail = err
    if not detail:
        detail = response.text or response.reason_phrase or ""
    return detail


def extract_model_ids(data: Any, provider_mode: str) -> list[str]:
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
            mid = (
                item.get("id") or item.get("name") or item.get("model") or ""
            ).strip()
            if provider_mode == "gemini" and mid.startswith("models/"):
                mid = mid[len("models/") :]
            if mid:
                model_ids.append(mid)
        elif isinstance(item, str) and item.strip():
            mid = item.strip()
            if provider_mode == "gemini" and mid.startswith("models/"):
                mid = mid[len("models/") :]
            model_ids.append(mid)

    return sorted(set(model_ids))


async def probe_anthropic_messages(
    client: httpx.AsyncClient,
    payload: ModelListRequest,
    header_variants: list[dict[str, str]],
) -> tuple[bool, int, str]:
    model = str(payload.model or "").strip()
    if not model:
        return (
            False,
            400,
            "模型列表接口不可用，且当前未填写模型 ID，无法继续验证 Messages 接口",
        )

    api_url = ProviderConfig.get_api_url(
        payload.provider,
        payload.apiUrl,
        "anthropic",
        model,
        stream=False,
    )
    probe_body = {
        "model": model,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "ping"}],
    }

    last_status = 502
    last_detail = "Anthropic Messages 接口探测失败"
    for headers in header_variants:
        response = await client.post(api_url, headers=headers, json=probe_body)
        try:
            data = response.json()
        except Exception:
            data = None

        if response.status_code < 400:
            return True, response.status_code, ""

        last_status = response.status_code
        last_detail = extract_error_detail(response, data)

    return False, last_status, last_detail


@router.post("/models/list")
async def list_models(payload: ModelListRequest):
    provider = (payload.provider or "openai").strip().lower()
    provider_mode = ProviderConfig.get_provider_mode(provider)
    api_key = (payload.apiKey or "").strip()

    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 API Key")

    header_variants = build_model_list_header_variants(api_key, provider_mode)
    last_status = 502
    last_detail = "获取模型列表失败"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            for url in build_models_candidate_urls(str(payload.apiUrl or ""), provider_mode):
                for headers in header_variants:
                    resp = await client.get(url, headers=headers)

                    try:
                        data = resp.json()
                    except Exception:
                        data = None

                    if resp.status_code >= 400:
                        last_status = resp.status_code
                        last_detail = extract_error_detail(resp, data)
                        continue

                    model_ids = extract_model_ids(data, provider_mode)
                    if model_ids:
                        return {
                            "models": model_ids,
                            "connectivityMode": "models_list",
                        }

                    last_status = 502
                    last_detail = "获取到的模型列表为空或格式不支持"

            if provider_mode == "anthropic":
                success, probe_status, probe_detail = await probe_anthropic_messages(
                    client,
                    payload,
                    header_variants,
                )
                if success:
                    model = str(payload.model or "").strip()
                    return {
                        "models": [model],
                        "connectivityMode": "messages_probe",
                        "message": "模型列表接口不可用，已通过 Messages 接口验证连接",
                    }
                last_status = probe_status
                last_detail = probe_detail
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"模型列表请求失败: {e}") from e

    raise HTTPException(status_code=last_status, detail=f"获取模型列表失败: {last_detail}")
