import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse


router = APIRouter()


@router.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def proxy(full_path: str, request: Request):
    if request.method == "OPTIONS":
        return {"status": "ok"}

    if not full_path.startswith("http"):
        return {"error": "无效的目标URL"}

    target_url = full_path
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

