from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse


router = APIRouter(prefix="/proxy")


def _validate_proxy_url(raw_url: str) -> str:
    target_url = str(raw_url or "").strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="缺少目标URL")

    parsed = urlparse(target_url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="仅支持 http/https 资源")

    return target_url


@router.get("/file")
async def proxy_file(url: str = Query(..., description="需要代理下载的远程文件地址")):
    target_url = _validate_proxy_url(url)

    try:
        async with httpx.AsyncClient(timeout=90.0, follow_redirects=True) as client:
            response = await client.get(target_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"代理下载失败: {exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"远程资源获取失败: HTTP {response.status_code}",
        )

    media_type = str(response.headers.get("content-type") or "").strip() or None
    headers = {}
    content_length = str(response.headers.get("content-length") or "").strip()
    if content_length:
        headers["Content-Length"] = content_length
    content_disposition = str(response.headers.get("content-disposition") or "").strip()
    if content_disposition:
        headers["Content-Disposition"] = content_disposition

    return Response(
        content=response.content,
        media_type=media_type,
        headers=headers,
    )


@router.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def proxy(full_path: str, request: Request):
    if request.method == "OPTIONS":
        return {"status": "ok"}

    target_url = _validate_proxy_url(full_path)
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("origin", None)
    headers.pop("referer", None)

    try:
        body = await request.body()

        async def stream_response():
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    method=request.method,
                    url=target_url,
                    headers=headers,
                    content=body,
                ) as response:
                    async for chunk in response.aiter_bytes():
                        yield chunk

        return StreamingResponse(
            stream_response(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    except Exception as e:
        print(f"代理错误: {str(e)}")
        return {"error": str(e)}

