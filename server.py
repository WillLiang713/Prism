"""
Prism - CORS代理服务器 (Python版本)

使用方法：
1. 安装依赖：pip install fastapi uvicorn httpx
2. 运行服务器：python server.py
3. 访问应用：http://localhost:3000/

工作原理：
- 接收格式：http://localhost:3000/https://api.openai.com/v1/chat/completions
- 自动转发到真实API地址，并添加CORS头
"""

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import httpx
import os
from urllib.parse import urlparse
from ai_service import AIService, ChatRequest

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

# 挂载静态文件目录（必须在通配符路由之前定义）
app.mount("/libs", StaticFiles(directory="frontend/libs"), name="libs")

# 静态文件路由（必须在通配符路由之前定义）
@app.get("/")
async def serve_index():
    """提供主页"""
    return FileResponse("frontend/index.html")

@app.get("/index.html")
async def serve_index_html():
    """提供主页"""
    return FileResponse("frontend/index.html")

@app.get("/style.css")
async def serve_style():
    """提供样式文件"""
    return FileResponse("frontend/style.css")

@app.get("/app.js")
async def serve_app():
    """提供JS文件"""
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

# 模型列表拉取（由后端请求第三方，前端只调用本地接口）
class ModelListRequest(BaseModel):
    provider: str = Field(default="openai")
    customFormat: str = Field(default="openai")
    apiKey: str | None = None
    apiUrl: str | None = None


@app.post("/api/models/list")
async def list_models(payload: ModelListRequest):
    provider = (payload.provider or "openai").strip().lower()
    custom_format = (payload.customFormat or "openai").strip().lower()
    provider_mode = "anthropic" if (provider == "anthropic" or (provider == "custom" and custom_format == "anthropic")) else "openai"

    raw_api_url = (payload.apiUrl or "").strip()
    if raw_api_url:
        parsed = urlparse(raw_api_url)
        if not parsed.scheme or not parsed.netloc:
            raise HTTPException(status_code=400, detail="无法解析 API 地址（用于获取模型列表）")
        path = parsed.path or ""
        v1_index = path.find("/v1")
        base = f"{parsed.scheme}://{parsed.netloc}{path[:v1_index + 3]}" if v1_index >= 0 else f"{parsed.scheme}://{parsed.netloc}"
    else:
        base = "https://api.anthropic.com/v1" if provider_mode == "anthropic" else "https://api.openai.com/v1"

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

# AI聊天接口（流式响应）
@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """
    AI聊天流式接口

    接收前端的聊天请求，调用AI提供商API，返回流式响应
    """
    return StreamingResponse(
        AIService.chat_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # 禁用nginx缓冲
        }
    )

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

    # 复制请求头，移除可能导致问题的头
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("origin", None)
    headers.pop("referer", None)

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
                    async for chunk in response.aiter_bytes():
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
