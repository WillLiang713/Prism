import os

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api")


class TavilySearchRequest(BaseModel):
    api_key: str | None = None
    query: str = Field(min_length=1, max_length=2000)
    search_depth: str = Field(default="basic")
    max_results: int = Field(default=5, ge=1, le=20)
    include_answer: bool = False
    include_raw_content: bool = False
    include_images: bool = False
    include_domains: list[str] | None = None
    exclude_domains: list[str] | None = None


@router.post("/tavily/search")
async def tavily_search(payload: TavilySearchRequest):
    api_key = (payload.api_key or os.getenv("TAVILY_API_KEY", "")).strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="缺少 Tavily API Key（请设置环境变量 TAVILY_API_KEY 或在请求体中传 api_key）")

    body = payload.model_dump(exclude_none=True)
    body["api_key"] = api_key

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post("https://api.tavily.com/search", json=body)
    except httpx.HTTPError as e:
        print(f"Tavily 请求错误: {type(e).__name__} - {e}")
        raise HTTPException(status_code=502, detail=f"Tavily请求失败: {type(e).__name__} - {str(e)}") from e
    except Exception as e:
        print(f"Tavily 未知错误: {type(e).__name__} - {e}")
        raise HTTPException(status_code=502, detail=f"Tavily请求异常: {type(e).__name__} - {str(e)}") from e

    if resp.status_code >= 400:
        try:
            detail = resp.json()
            print(f"Tavily API 返回错误 {resp.status_code}: {detail}")
        except Exception:
            detail = resp.text
            print(f"Tavily API 返回错误 {resp.status_code}: {detail}")
        raise HTTPException(status_code=resp.status_code, detail=detail)

    return resp.json()


class ExaSearchRequest(BaseModel):
    api_key: str | None = None
    query: str = Field(min_length=1, max_length=2000)
    max_results: int = Field(default=5, ge=1, le=20)
    search_type: str = Field(default="auto")


@router.post("/exa/search")
async def exa_search(payload: ExaSearchRequest):
    api_key = (payload.api_key or os.getenv("EXA_API_KEY", "")).strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="缺少 Exa API Key（请设置环境变量 EXA_API_KEY 或在请求体中传 api_key）")

    allowed_types = {"neural", "fast", "auto", "deep", "deep-reasoning", "deep-max", "instant"}
    resolved_type = str(payload.search_type or "auto").lower()
    if resolved_type not in allowed_types:
        resolved_type = "auto"

    body = {
        "query": payload.query,
        "numResults": payload.max_results,
        "type": resolved_type,
    }
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "Authorization": f"Bearer {api_key}",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post("https://api.exa.ai/search", json=body, headers=headers)
    except httpx.HTTPError as e:
        print(f"Exa 请求错误: {type(e).__name__} - {e}")
        raise HTTPException(status_code=502, detail=f"Exa请求失败: {type(e).__name__} - {str(e)}") from e
    except Exception as e:
        print(f"Exa 未知错误: {type(e).__name__} - {e}")
        raise HTTPException(status_code=502, detail=f"Exa请求异常: {type(e).__name__} - {str(e)}") from e

    if resp.status_code >= 400:
        try:
            detail = resp.json()
            print(f"Exa API 返回错误 {resp.status_code}: {detail}")
        except Exception:
            detail = resp.text
            print(f"Exa API 返回错误 {resp.status_code}: {detail}")
        raise HTTPException(status_code=resp.status_code, detail=detail)

    return resp.json()

