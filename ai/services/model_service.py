from typing import Any

import httpx
from fastapi import HTTPException

from ..providers import get_provider_adapter


class ModelService:
    @staticmethod
    def _extract_error_detail(response: httpx.Response, data: Any) -> str:
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

    @staticmethod
    async def list_models(payload):
        provider = str(payload.provider or "openai").strip().lower()
        adapter = get_provider_adapter(provider)
        api_key = str(payload.apiKey or "").strip()

        if not api_key:
            raise HTTPException(status_code=400, detail="缺少 API Key")

        header_variants = adapter.build_model_list_header_variants(api_key)
        last_status = 502
        last_detail = "获取模型列表失败"

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                for url in adapter.build_models_candidate_urls(payload.apiUrl):
                    for headers in header_variants:
                        resp = await client.get(url, headers=headers)

                        try:
                            data = resp.json()
                        except Exception:
                            data = None

                        if resp.status_code >= 400:
                            last_status = resp.status_code
                            last_detail = ModelService._extract_error_detail(resp, data)
                            continue

                        model_ids = adapter.extract_model_ids(data)
                        if model_ids:
                            return {
                                "models": model_ids,
                                "connectivityMode": "models_list",
                            }

                        last_status = 502
                        last_detail = "获取到的模型列表为空或格式不支持"

                if adapter.provider_mode == "anthropic":
                    success, probe_status, probe_detail = await adapter.probe_model_connection(
                        client,
                        provider,
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
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"模型列表请求失败: {e}") from e

        raise HTTPException(status_code=last_status, detail=f"获取模型列表失败: {last_detail}")
