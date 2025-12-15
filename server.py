"""
AI对比工具 - CORS代理服务器 (Python版本)

使用方法：
1. 安装依赖：pip install fastapi uvicorn httpx
2. 运行服务器：python server.py
3. 访问应用：http://localhost:3000/

工作原理：
- 接收格式：http://localhost:3000/https://api.openai.com/v1/chat/completions
- 自动转发到真实API地址，并添加CORS头
"""

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx
import os

app = FastAPI(title="CORS代理服务器")

# 配置CORS - 允许所有来源
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# 静态文件路由（必须在通配符路由之前定义）
@app.get("/")
async def serve_index():
    """提供主页"""
    from fastapi.responses import FileResponse
    return FileResponse("frontend/index.html")

@app.get("/index.html")
async def serve_index_html():
    """提供主页"""
    from fastapi.responses import FileResponse
    return FileResponse("frontend/index.html")

@app.get("/style.css")
async def serve_style():
    """提供样式文件"""
    from fastapi.responses import FileResponse
    return FileResponse("frontend/style.css")

@app.get("/app.js")
async def serve_app():
    """提供JS文件"""
    from fastapi.responses import FileResponse
    return FileResponse("frontend/app.js")

# Tavily 联网搜索（推荐：服务端保存 API Key）
class TavilySearchRequest(BaseModel):
    api_key: str | None = None
    query: str = Field(min_length=1, max_length=2000)
    search_depth: str = Field(default="basic")  # basic | advanced
    max_results: int = Field(default=5, ge=1, le=20)
    include_answer: bool = False
    include_raw_content: bool = False
    include_images: bool = False
    include_domains: list[str] | None = None
    exclude_domains: list[str] | None = None


@app.post("/api/tavily/search")
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
        raise HTTPException(status_code=502, detail=f"Tavily请求失败: {e}") from e

    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise HTTPException(status_code=resp.status_code, detail=detail)

    return resp.json()

# 代理路由（通配符，必须放在最后）
@app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def proxy(full_path: str, request: Request):
    """透明代理所有请求"""

    # 处理OPTIONS预检请求
    if request.method == "OPTIONS":
        return {"status": "ok"}

    # 从路径中提取真实的API地址
    # 例如：/https://api.openai.com/v1/chat/completions
    if not full_path.startswith("http"):
        return {"error": "无效的目标URL"}

    target_url = full_path
    print(f"代理请求: {request.method} {target_url}")

    # 复制请求头，移除可能导致问题的头
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("origin", None)
    headers.pop("referer", None)

    # 调试日志
    print(f"转发的请求头: Authorization={'已设置' if 'authorization' in headers else '未设置'}, "
          f"x-api-key={'已设置' if 'x-api-key' in headers else '未设置'}")

    try:
        # 读取请求体
        body = await request.body()

        # 流式转发请求
        async def stream_response():
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    method=request.method,
                    url=target_url,
                    headers=headers,
                    content=body
                ) as response:
                    print(f"API响应状态码: {response.status_code}")
                    print(f"API响应头: {dict(response.headers)}")

                    chunk_count = 0
                    async for chunk in response.aiter_bytes():
                        chunk_count += 1
                        if chunk_count <= 3:  # 只打印前3个chunk
                            print(f"收到chunk {chunk_count}: {len(chunk)} bytes")
                        yield chunk

        # 保持原始响应的Content-Type
        return StreamingResponse(
            stream_response(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            }
        )

    except Exception as e:
        print(f"代理错误: {str(e)}")
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    print("=" * 50)
    print("AI对比工具服务器已启动")
    print("=" * 50)
    print("访问地址: http://localhost:3000")
    print("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=3000)
