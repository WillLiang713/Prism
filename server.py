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
import json
import re
from datetime import datetime
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
@app.get("/api/tools")
async def get_tools():
    """获取所有可用工具列表"""
    try:
        with open("tools.json", "r", encoding="utf-8") as f:
            tools = json.load(f)
        return {"tools": tools}
    except Exception as e:
        return {"tools": [], "error": str(e)}
# 获取工具列表
@app.get("/api/tools")
async def get_tools():
    """从 tools.json 读取工具定义"""
    try:
        with open("tools.json", "r", encoding="utf-8") as f:
            tools = json.load(f)
        return {"tools": tools}
    except FileNotFoundError:
        return {"tools": []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取工具列表失败: {str(e)}")

# 执行工具函数
@app.post("/api/tools/execute")
async def execute_tool_endpoint(request: Request):
    """执行工具调用"""
    from tools import execute_tool
    
    body = await request.json()
    tool_name = body.get("name")
    arguments = body.get("arguments", {})
    
    result = execute_tool(tool_name, arguments)
    return {"result": result}

# Tavily 联网搜索（推荐:服务端保存 API Key）
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

# 模型列表拉取（由后端请求第三方，前端只调用本地接口）
class ModelListRequest(BaseModel):
    provider: str = Field(default="openai")
    apiKey: str | None = None
    apiUrl: str | None = None


def normalize_api_url(raw_url: str) -> str:
    """兼容只填域名的输入，默认补全 https://"""
    value = (raw_url or "").strip()
    if not value:
        return ""
    if "://" not in value:
        value = f"https://{value}"
    return value


def build_models_base_url(raw_url: str, provider_mode: str) -> str:
    """根据配置构建模型列表接口基础地址（确保以 /v1 结尾）"""
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


@app.post("/api/models/list")
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

# 生成话题标题
class GenerateTitleRequest(BaseModel):
    # 提供商配置
    provider: str = Field(default="openai")
    apiKey: str
    model: str
    apiUrl: str | None = None

    # 对话历史（最多取前几轮）
    messages: list[dict[str, str]]  # [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]

def _normalize_compare_text(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", str(text or ""), flags=re.UNICODE).lower()

def _first_user_message(messages: list[dict[str, str]]) -> str:
    for msg in messages:
        if isinstance(msg, dict) and (msg.get("role") or "") == "user":
            text = str(msg.get("content") or "").strip()
            if text:
                return text
    return ""

def _fallback_title_from_messages(messages: list[dict[str, str]]) -> str:
    first = _first_user_message(messages)
    if not first:
        return "新对话"

    title = re.sub(r"\s+", " ", first).strip()
    title = title.splitlines()[0].strip()
    if not title:
        return "新对话"
    return title[:24]

def _is_too_close_to_user_input(title: str, messages: list[dict[str, str]]) -> bool:
    first_user = _first_user_message(messages)
    if not first_user:
        return False
    t = _normalize_compare_text(title)
    u = _normalize_compare_text(first_user)
    if not t or not u:
        return False
    return t in u or u in t

def _normalize_generated_title(raw_title: str, messages: list[dict[str, str]]) -> tuple[str, str]:
    """清洗模型标题输出，返回 (title, source)"""
    title = str(raw_title or "").strip()
    if not title:
        return _fallback_title_from_messages(messages), "fallback"

    # 仅使用首行，过滤解释文本
    title = title.splitlines()[0].strip()
    title = re.sub(r"^(标题|话题|主题)\s*[:：]\s*", "", title)
    title = re.sub(r"^[\-\*\d\.\)\(、\s]+", "", title)
    title = title.strip('"\'「」『』`')
    title = re.sub(r"\s+", " ", title).strip()

    if not title:
        return _fallback_title_from_messages(messages), "fallback"

    # 过滤解释式回答和无效标题
    if re.search(r"(根据.*对话|建议标题|可以命名|这个对话|标题是)", title):
        return _fallback_title_from_messages(messages), "fallback"
    if title in {"新对话", "未命名", "对话"}:
        return _fallback_title_from_messages(messages), "fallback"

    if len(title) > 24:
        short = re.split(r"[，,。；;！？!?\|]", title, maxsplit=1)[0].strip()
        title = short if short else title[:24].strip()

    if _is_too_close_to_user_input(title, messages):
        return _fallback_title_from_messages(messages), "fallback"

    return title, "model"


@app.post("/api/topics/generate-title")
async def generate_topic_title(payload: GenerateTitleRequest):
    """
    根据对话历史生成话题标题
    
    使用指定的模型分析对话内容，生成简短的标题（5-15字）
    """
    try:
        # 构建提示词：让AI根据对话历史生成简短标题
        system_prompt = (
            "你是话题标题生成助手。请基于对话语义生成4-12字的中文名词短语标题。"
            "禁止复述用户原句，禁止输出解释，禁止使用“这个对话”“标题是”等表述。"
            "只输出标题文本。"
        )
        
        # 构建对话内容摘要
        conversation_summary = []
        for msg in payload.messages[:6]:  # 只取前6条消息
            role = msg.get("role", "")
            content = msg.get("content", "")[:200]  # 限制每条消息长度
            if role and content:
                conversation_summary.append(f"{role}: {content}")
        
        user_prompt = (
            "请为以下对话生成一个简洁标题（4-12字，概括意图，不要复述原句）：\n\n"
            + "\n".join(conversation_summary)
        )
        
        # 构建请求
        provider_mode = "anthropic" if payload.provider == "anthropic" else "openai"
        
        # 获取API URL
        from ai_service import ProviderConfig
        api_url = ProviderConfig.get_api_url(payload.provider, payload.apiUrl, provider_mode)
        
        # 构建请求体
        if provider_mode == "anthropic":
            request_body = {
                "model": payload.model,
                "max_tokens": 50,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "temperature": 0.7
            }
            headers = {
                "x-api-key": payload.apiKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
        else:
            request_body = {
                "model": payload.model,
                "max_tokens": 50,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.7
            }
            headers = {
                "Authorization": f"Bearer {payload.apiKey}",
                "Content-Type": "application/json"
            }
        
        # 发送请求
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(api_url, json=request_body, headers=headers)
        
        if resp.status_code >= 400:
            try:
                error_data = resp.json()
                error_message = error_data.get("error", {}).get("message", resp.text)
            except:
                error_message = resp.text
            raise HTTPException(status_code=resp.status_code, detail=f"AI请求失败: {error_message}")
        
        data = resp.json()
        
        # 提取标题
        if provider_mode == "anthropic":
            title = data.get("content", [{}])[0].get("text", "").strip()
        else:
            title = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        
        # 清洗并兜底标题
        title, source = _normalize_generated_title(title, payload.messages)
        
        return {"title": title, "source": source}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"生成标题错误: {type(e).__name__} - {e}")
        raise HTTPException(status_code=500, detail=f"生成标题失败: {str(e)}")

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
