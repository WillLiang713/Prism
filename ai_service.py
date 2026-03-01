"""
AI服务模块

封装与AI提供商交互的核心逻辑:
1. 请求构建 (支持OpenAI和Anthropic格式)
2. 流式响应处理
3. 多模态支持 (文本+图片)
4. 对话历史管理
"""

from typing import Any, AsyncIterator, Literal
from datetime import datetime
from pydantic import BaseModel, Field
import httpx
import json


# ==================== 数据模型 ====================

class ImageContent(BaseModel):
    """图片内容"""
    id: str
    dataUrl: str
    name: str
    size: int
    type: str | None = None


class HistoryTurn(BaseModel):
    """历史对话轮次"""
    prompt: str
    images: list[ImageContent] = []
    models: dict[str, Any] = {}


class ChatRequest(BaseModel):
    """AI聊天请求"""
    # 提供商配置
    provider: str = Field(default="openai")
    apiKey: str
    model: str
    apiUrl: str | None = None

    # 消息内容
    prompt: str
    images: list[ImageContent] = []
    systemPrompt: str | None = None

    # 推理与工具
    reasoningEffort: str = "none"
    enableTools: bool = False  # 是否启用工具调用
    maxToolRounds: int = Field(default=50, ge=1, le=200)  # 最大工具调用轮数（实际不再限制）
    selectedTools: list[str] = []  # 选中的工具名称列表

    # 联网相关
    webSearchProvider: str = Field(default="tavily")  # 联网服务提供方（tavily|exa）
    webSearchMaxResults: int | None = Field(default=None, ge=1, le=20)  # 联网默认结果数量
    tavilyApiKey: str | None = None  # Tavily Key（可选，优先于环境变量）
    exaApiKey: str | None = None  # Exa Key（可选，优先于环境变量）
    tavilyMaxResults: int = Field(default=5, ge=1, le=20)  # Tavily 默认结果数量
    tavilySearchDepth: str = Field(default="basic")  # Tavily 默认搜索深度（basic|advanced）

    # 历史输入（后端直接使用，不再受开关控制）
    historyTurns: list[HistoryTurn] = []


class StreamChunk(BaseModel):
    """流式响应块"""
    type: Literal["thinking", "content", "tokens", "error", "tool"]
    data: Any


# ==================== 提供商配置 ====================

class ProviderConfig:
    """AI提供商配置"""

    DEFAULT_URLS = {
        "openai": "https://api.openai.com/v1/chat/completions",
        "anthropic": "https://api.anthropic.com/v1/messages"
    }

    @staticmethod
    def normalize_api_url(api_url: str | None) -> str:
        """兼容仅填写域名的地址，默认补全 https://"""
        url = (api_url or "").strip()
        if not url:
            return ""
        if "://" not in url:
            url = f"https://{url}"
        return url

    @staticmethod
    def get_provider_mode(provider: str) -> str:
        """判断提供商模式"""
        provider = provider.strip().lower()
        return "anthropic" if provider == "anthropic" else "openai"

    @staticmethod
    def get_api_url(provider: str, api_url: str | None, provider_mode: str) -> str:
        """获取API地址，自动拼接v1路径"""
        url = ProviderConfig.normalize_api_url(api_url)

        if not url:
            if provider == "custom":
                raise ValueError("选择'自定义'时必须填写 API 地址")
            return ProviderConfig.DEFAULT_URLS.get(provider_mode, ProviderConfig.DEFAULT_URLS["openai"])

        # 移除末尾的斜杠
        url = url.rstrip('/')
        url_lower = url.lower()
        
        # 检查是否已经包含完整的API端点
        if '/chat/completions' not in url_lower and '/messages' not in url_lower:
            # 根据provider_mode自动拼接对应的端点
            if provider_mode == "anthropic":
                # Anthropic格式: /v1/messages
                if not url_lower.endswith('/v1'):
                    url = f"{url}/v1/messages"
                else:
                    url = f"{url}/messages"
            else:
                # OpenAI格式: /v1/chat/completions
                if not url_lower.endswith('/v1'):
                    url = f"{url}/v1/chat/completions"
                else:
                    url = f"{url}/chat/completions"

        return url

    @staticmethod
    def build_headers(api_key: str, provider_mode: str) -> dict[str, str]:
        """构建请求头"""
        headers = {"Content-Type": "application/json"}

        if provider_mode == "anthropic":
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
        else:
            headers["Authorization"] = f"Bearer {api_key}"

        return headers


# ==================== 消息构建器 ====================

class MessageBuilder:
    """消息构建器"""

    DEFAULT_SYSTEM_PROMPT = """你是一个“实时信息优先”的中文助手，回答目标是：准确、及时、可核实。
请把以下时间作为本轮对话的判断基准：
- 当前日期时间：{{datetime}}
- 当前日期：{{date}}
- 当前时间：{{time}}
- 当前时间戳：{{timestamp}}

【核心原则】
1) 只要问题可能受时间影响，就先联网搜索，再回答。
2) 不凭记忆猜“最新消息”；不确定就查证。
3) 若证据不足，明确说“不确定”，不要编造。

【必须优先联网的场景】
- 用户出现“今天、现在、当前、刚刚、最新、最近、实时、截至”等词。
- 新闻动态、政策变化、价格/汇率/股价、天气、比赛结果、航班交通、软件版本更新等易变化信息。
- 任何需要“此刻仍然成立”的结论。
- 你主观把握不足（低于90%把握）时。

【联网执行规则】
1) 判定需要联网后，先调用搜索工具，再输出正式答案。
2) 重要问题至少进行两次检索（换关键词再查一次）并交叉核对。
3) 检索词尽量包含：主题 + 时间范围 + 地区/对象。
4) 若首次结果不够新或不够全，自动补搜，不要直接结束。

【回答输出规则】
1) 先给结论，再给关键依据（时间点、数字、适用条件）。
2) 明确标注“已确认信息”和“可能变化信息”。
3) 来源链接会在界面自动展示，正文中不要重复堆链接。
4) 搜索失败时，清楚说明失败原因，并给出可执行的下一步（如建议稍后重试或提供更具体关键词）。

【无需联网的场景】
- 稳定基础知识、数学推导、代码语法、通用写作润色（除非用户明确要求最新资料）。"""

    @staticmethod
    def _render_system_prompt_template(template: str, now: datetime) -> str:
        """渲染系统提示词中的模板变量。未知变量保持原样。"""
        text = str(template or "")
        replacements = {
            "{{datetime}}": now.strftime("%Y-%m-%d %H:%M:%S"),
            "{{date}}": now.strftime("%Y-%m-%d"),
            "{{time}}": now.strftime("%H:%M:%S"),
            "{{timestamp}}": str(int(now.timestamp())),
        }
        for key, value in replacements.items():
            text = text.replace(key, value)
        return text

    @staticmethod
    def _resolve_system_prompt(config_prompt: str | None, now: datetime) -> str:
        """解析系统提示词：用户自定义优先，留空则使用内置默认。"""
        custom_prompt = (config_prompt or "").strip()
        template = custom_prompt if custom_prompt else MessageBuilder.DEFAULT_SYSTEM_PROMPT
        return MessageBuilder._render_system_prompt_template(template, now)

    @staticmethod
    def convert_history_to_messages(
        history_turns: list[HistoryTurn],
        side: str,
        provider_mode: str
    ) -> list[dict]:
        """将历史turns转换为消息数组"""
        if not history_turns:
            return []

        messages = []

        for turn in history_turns:
            # 跳过未完成或出错的turn
            model_data = turn.models.get(side, {})
            if not model_data.get("content") or model_data.get("status") != "complete":
                continue

            # 构建用户消息
            user_content = MessageBuilder._build_user_content(
                turn.prompt,
                turn.images,
                provider_mode
            )
            messages.append({"role": "user", "content": user_content})

            # 构建助手消息
            assistant_content = model_data.get("content")
            if assistant_content:
                messages.append({"role": "assistant", "content": assistant_content})

        return messages

    @staticmethod
    def _build_user_content(prompt: str, images: list[ImageContent], provider_mode: str) -> str | list[dict]:
        """构建用户消息内容(支持多模态)"""
        has_images = images and len(images) > 0

        if not has_images:
            return prompt

        # 多模态消息
        if provider_mode == "anthropic":
            content = []
            if prompt:
                content.append({"type": "text", "text": prompt})

            for img in images:
                # 解析dataUrl: data:image/png;base64,xxxxx
                parts = img.dataUrl.split(",", 1)
                if len(parts) == 2:
                    header = parts[0]  # data:image/png;base64
                    base64_data = parts[1]

                    # 提取media_type
                    media_type = "image/png"
                    if ":" in header and ";" in header:
                        media_type = header.split(":")[1].split(";")[0]

                    content.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": base64_data
                        }
                    })

            return content
        else:
            # OpenAI格式
            content = []
            if prompt:
                content.append({"type": "text", "text": prompt})

            for img in images:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": img.dataUrl}
                })

            return content

    @staticmethod
    def build_request_body(
        config: ChatRequest,
        provider_mode: str,
        current_user_content: str | list[dict],
        history_messages: list[dict]
    ) -> dict:
        """构建请求体"""
        if provider_mode == "anthropic":
            return MessageBuilder._build_anthropic_body(
                config, current_user_content, history_messages
            )
        else:
            return MessageBuilder._build_openai_body(
                config, current_user_content, history_messages
            )

    @staticmethod
    def _build_anthropic_body(
        config: ChatRequest,
        user_content: str | list[dict],
        history_messages: list[dict]
    ) -> dict:
        """构建Anthropic格式请求体"""
        # 合并历史消息和当前消息
        all_messages = [*history_messages, {"role": "user", "content": user_content}]

        body = {
            "model": config.model,
            "messages": all_messages,
            "stream": True,
            "max_tokens": 4096
        }

        # 系统提示词（用户自定义优先；留空时使用内置默认；支持模板变量替换）
        now = datetime.now()
        system_text = MessageBuilder._resolve_system_prompt(config.systemPrompt, now)
        if system_text:
            body["system"] = system_text

        # 思考模式
        if config.reasoningEffort and config.reasoningEffort != "none":
            budget_map = {"minimal": 512, "low": 1024, "medium": 2048, "high": 4096, "xhigh": 8192}
            body["thinking"] = {
                "type": "enabled",
                "budget_tokens": budget_map.get(config.reasoningEffort, 2048)
            }

        return body

    @staticmethod
    def _build_openai_body(
        config: ChatRequest,
        user_content: str | list[dict],
        history_messages: list[dict]
    ) -> dict:
        """构建OpenAI格式请求体"""
        messages = []

        # 系统提示词（用户自定义优先；留空时使用内置默认；支持模板变量替换）
        now = datetime.now()
        system_text = MessageBuilder._resolve_system_prompt(config.systemPrompt, now)
        if system_text:
            messages.append({"role": "system", "content": system_text})

        # 历史消息
        messages.extend(history_messages)

        # 当前用户消息
        messages.append({"role": "user", "content": user_content})

        body = {
            "model": config.model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True}
        }

        # 添加工具定义
        if config.enableTools:
            try:
                import json
                with open("tools.json", "r", encoding="utf-8") as f:
                    all_tools = json.load(f)
                    
                    # selectedTools 有值时按选择加载；为空时默认加载全部
                    if config.selectedTools:
                        tools = [
                            tool for tool in all_tools
                            if tool.get("function", {}).get("name") in config.selectedTools
                        ]
                    else:
                        # 向后兼容：未传或为空时加载全部工具
                        tools = all_tools
                    
                    if tools:
                        body["tools"] = tools
            except Exception:
                pass

        # 思考模式
        if config.reasoningEffort and config.reasoningEffort != "none":
            body["reasoning_effort"] = config.reasoningEffort

        return body


# ==================== 流式响应解析器 ====================

class StreamParser:
    """流式响应解析器"""

    @staticmethod
    def parse_anthropic_chunk(chunk: dict) -> dict:
        """解析Anthropic流式响应块"""
        result = {"thinking": "", "content": "", "tokens": None}

        if chunk.get("type") == "content_block_delta":
            delta = chunk.get("delta", {})
            if delta.get("type") == "thinking_delta":
                result["thinking"] = delta.get("thinking", "")
            elif delta.get("type") == "text_delta":
                result["content"] = delta.get("text", "")

        elif chunk.get("type") == "message_delta":
            usage = chunk.get("usage", {})
            if usage:
                result["tokens"] = usage.get("output_tokens", 0)

        return result

    @staticmethod
    def parse_openai_chunk(chunk: dict) -> dict:
        """解析OpenAI流式响应块"""
        result = {"thinking": "", "content": "", "tokens": None, "tool_calls": None}

        choices = chunk.get("choices", [])
        if choices and len(choices) > 0:
            delta = choices[0].get("delta", {})

            # 思考内容
            if "reasoning_content" in delta:
                result["thinking"] = delta["reasoning_content"]

            # 正常内容
            if "content" in delta:
                result["content"] = delta["content"]
            
            # 工具调用
            if "tool_calls" in delta and delta["tool_calls"]:
                result["tool_calls"] = delta["tool_calls"]

        # Token统计
        usage = chunk.get("usage", {})
        if usage:
            result["tokens"] = (
                usage.get("completion_tokens") or
                usage.get("output_tokens") or
                usage.get("total_tokens") or
                0
            )

        return result


# ==================== AI服务 ====================

class AIService:
    """AI服务主类"""

    @staticmethod
    async def execute_tool(
        tool_name: str,
        arguments: dict,
        runtime_context: dict[str, Any] | None = None
    ) -> str:
        """执行工具调用"""
        from tools import (
            execute_tool as sync_execute_tool,
            set_runtime_context,
            reset_runtime_context,
        )
        token = set_runtime_context(runtime_context)
        try:
            return sync_execute_tool(tool_name, arguments)
        finally:
            reset_runtime_context(token)

    @staticmethod
    async def chat_stream(request: ChatRequest) -> AsyncIterator[str]:
        """
        流式聊天接口

        Args:
            request: 聊天请求

        Yields:
            SSE格式的流式响应
        """
        try:
            # 确定提供商模式
            provider_mode = ProviderConfig.get_provider_mode(request.provider)

            # 获取API地址
            url = ProviderConfig.get_api_url(
                request.provider,
                request.apiUrl,
                provider_mode
            )

            # 构建请求头
            headers = ProviderConfig.build_headers(request.apiKey, provider_mode)

            # 构建历史消息
            history_messages = []
            if request.historyTurns:
                history_messages = MessageBuilder.convert_history_to_messages(
                    request.historyTurns,
                    "main",
                    provider_mode
                )

            # 构建当前用户消息
            current_user_content = MessageBuilder._build_user_content(
                request.prompt,
                request.images,
                provider_mode
            )

            # 构建请求体
            body = MessageBuilder.build_request_body(
                request,
                provider_mode,
                current_user_content,
                history_messages
            )

            # 发起流式请求
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    method="POST",
                    url=url,
                    headers=headers,
                    json=body
                ) as response:
                    if response.status_code >= 400:
                        error_text = await response.aread()
                        yield f"data: {json.dumps({'type': 'error', 'data': f'HTTP {response.status_code}: {error_text.decode()}'})}\n\n"
                        return

                    # 处理流式响应
                    buffer = ""
                    tool_calls_buffer = {}  # 用于累积工具调用信息
                    assistant_thinking = ""  # 累积思考内容
                    assistant_content = ""  # 累积正常内容
                    
                    async for chunk in response.aiter_bytes():
                        buffer += chunk.decode("utf-8", errors="ignore")

                        lines = buffer.split("\n")
                        buffer = lines.pop() if lines else ""

                        for line in lines:
                            line = line.strip()
                            if not line or line.startswith(":"):
                                continue

                            if not line.startswith("data: "):
                                continue

                            data = line[6:]
                            if data == "[DONE]":
                                continue

                            try:
                                chunk_json = json.loads(data)

                                # 解析响应块
                                if provider_mode == "anthropic":
                                    parsed = StreamParser.parse_anthropic_chunk(chunk_json)
                                else:
                                    parsed = StreamParser.parse_openai_chunk(chunk_json)

                                # 发送thinking增量
                                if parsed["thinking"]:
                                    assistant_thinking += parsed["thinking"]
                                    yield f"data: {json.dumps({'type': 'thinking', 'data': parsed['thinking']})}\n\n"

                                # 发送content增量
                                if parsed["content"]:
                                    assistant_content += parsed["content"]
                                    yield f"data: {json.dumps({'type': 'content', 'data': parsed['content']})}\n\n"
                                
                                # 处理工具调用
                                if parsed.get("tool_calls") and request.enableTools:
                                    for tool_call in parsed["tool_calls"]:
                                        idx = tool_call.get("index", 0)
                                        if idx not in tool_calls_buffer:
                                            tool_calls_buffer[idx] = {
                                                "id": "",
                                                "name": "",
                                                "arguments": ""
                                            }
                                        
                                        if "id" in tool_call:
                                            tool_calls_buffer[idx]["id"] = tool_call["id"]
                                        
                                        if "function" in tool_call:
                                            func = tool_call["function"]
                                            if "name" in func and func["name"] is not None:
                                                tool_calls_buffer[idx]["name"] += func["name"]
                                            if "arguments" in func and func["arguments"] is not None:
                                                tool_calls_buffer[idx]["arguments"] += func["arguments"]

                                # 发送tokens统计
                                if parsed["tokens"] is not None:
                                    yield f"data: {json.dumps({'type': 'tokens', 'data': parsed['tokens']})}\n\n"

                            except json.JSONDecodeError as e:
                                # 忽略JSON解析错误
                                continue
                    
                    # 流结束后，如果有工具调用，执行并多轮请求 AI
                    current_round = 0
                    messages_with_tools = body["messages"].copy()
                    
                    while tool_calls_buffer and request.enableTools:
                        current_round += 1
                        resolved_max_results = request.webSearchMaxResults or request.tavilyMaxResults or 5
                        tool_runtime_context = {
                            "web_search_provider": str(request.webSearchProvider or "tavily").lower(),
                            "web_search_max_results": resolved_max_results,
                            "tavily_api_key": (request.tavilyApiKey or "").strip(),
                            "exa_api_key": (request.exaApiKey or "").strip(),
                            "tavily_max_results": request.tavilyMaxResults,
                            "tavily_search_depth": request.tavilySearchDepth,
                        }
                        
                        # 构建工具调用消息
                        tool_call_message = {
                            "role": "assistant",
                            "tool_calls": []
                        }
                        
                        # 为 DeepSeek 等模型添加必需的字段
                        if assistant_content:
                            tool_call_message["content"] = assistant_content
                        if assistant_thinking and provider_mode == "openai":
                            # DeepSeek 需要 reasoning_content 字段
                            model_lower = request.model.lower()
                            if "deepseek" in model_lower:
                                tool_call_message["reasoning_content"] = assistant_thinking
                            elif "o1" in model_lower:
                                tool_call_message["reasoning_content"] = assistant_thinking
                        
                        tool_results = []
                        for idx, tool_call in sorted(tool_calls_buffer.items()):
                            tool_name = tool_call["name"]
                            try:
                                args = json.loads(tool_call["arguments"]) if tool_call["arguments"] else {}
                            except:
                                args = {}

                            # 对 Tavily 搜索强制使用前端配置的默认深度，
                            # 忽略模型在本轮 tool call 中显式给出的 search_depth。
                            if tool_name == "tavily_search":
                                resolved_depth = (
                                    "advanced"
                                    if str(request.tavilySearchDepth).lower() == "advanced"
                                    else "basic"
                                )
                                args["search_depth"] = resolved_depth
                                args["max_results"] = resolved_max_results
                            elif tool_name == "exa_search":
                                args["max_results"] = resolved_max_results

                            # 通知前端：开始执行工具
                            yield f"data: {json.dumps({'type': 'tool', 'data': {'status': 'start', 'round': current_round, 'name': tool_name, 'arguments': args}})}\n\n"
                            
                            # 执行工具
                            result = await AIService.execute_tool(
                                tool_name,
                                args,
                                tool_runtime_context,
                            )

                            # 通知前端：工具执行结果摘要
                            result_status = "success"
                            result_summary = "调用完成"
                            try:
                                parsed_result = json.loads(result)
                                if isinstance(parsed_result, dict):
                                    if parsed_result.get("error"):
                                        result_status = "error"
                                        result_summary = str(parsed_result.get("error") or "工具返回错误")
                                    elif isinstance(parsed_result.get("results"), list):
                                        count = len(parsed_result.get("results", []))
                                        result_summary = f"返回 {count} 条结果"
                                    else:
                                        result_summary = json.dumps(parsed_result, ensure_ascii=False)
                                else:
                                    result_summary = str(parsed_result)
                            except Exception:
                                plain = str(result or "").strip()
                                if plain.startswith("错误"):
                                    result_status = "error"
                                result_summary = plain or "调用完成"

                            if len(result_summary) > 180:
                                result_summary = result_summary[:180] + "..."

                            yield f"data: {json.dumps({'type': 'tool', 'data': {'status': result_status, 'round': current_round, 'name': tool_name, 'resultSummary': result_summary}})}\n\n"

                            # 如果是搜索工具且成功，提取来源链接单独发送
                            if (
                                result_status == "success"
                                and tool_name in ("tavily_search", "exa_search")
                            ):
                                try:
                                    sr = json.loads(result)
                                    source_items = sr.get("results") if isinstance(sr, dict) else None
                                    if isinstance(source_items, list) and source_items:
                                        sources = [
                                            {"title": (s.get("title") or "").strip(), "url": (s.get("url") or "").strip()}
                                            for s in source_items
                                            if (s.get("url") or "").strip()
                                        ]
                                        if sources:
                                            yield f"data: {json.dumps({'type': 'sources', 'data': sources}, ensure_ascii=False)}\n\n"
                                except Exception:
                                    pass
                            
                            # 构建标准格式的 tool_call
                            tool_call_message["tool_calls"].append({
                                "id": tool_call["id"] or f"call_{idx}",
                                "type": "function",
                                "function": {
                                    "name": tool_name,
                                    "arguments": tool_call["arguments"]
                                }
                            })
                            
                            # 构建工具结果消息
                            tool_results.append({
                                "role": "tool",
                                "tool_call_id": tool_call["id"] or f"call_{idx}",
                                "content": result
                            })
                        
                        # 追加工具调用和结果到消息列表
                        messages_with_tools.append(tool_call_message)
                        messages_with_tools.extend(tool_results)
                        
                        # 清空并准备下一轮
                        tool_calls_buffer = {}
                        assistant_thinking = ""
                        assistant_content = ""
                        
                        # 再次请求 AI
                        body_next = body.copy()
                        body_next["messages"] = messages_with_tools
                        # 保留 tools 定义，允许 AI 继续调用工具
                        
                        # 发送下一轮请求
                        async with client.stream(
                            method="POST",
                            url=url,
                            headers=headers,
                            json=body_next
                        ) as response_next:
                            if response_next.status_code >= 400:
                                error_text = await response_next.aread()
                                yield f"data: {json.dumps({'type': 'error', 'data': f'工具调用失败 HTTP {response_next.status_code}: {error_text.decode()}'})}\n\n"
                                return
                            
                            # 处理流式响应
                            buffer_next = ""
                            async for chunk in response_next.aiter_bytes():
                                buffer_next += chunk.decode("utf-8", errors="ignore")
                                
                                lines = buffer_next.split("\n")
                                buffer_next = lines.pop() if lines else ""
                                
                                for line in lines:
                                    line = line.strip()
                                    if not line or line.startswith(":"):
                                        continue
                                    
                                    if not line.startswith("data: "):
                                        continue
                                    
                                    data = line[6:]
                                    if data == "[DONE]":
                                        continue
                                    
                                    try:
                                        chunk_json = json.loads(data)
                                        
                                        # 解析响应块
                                        if provider_mode == "anthropic":
                                            parsed = StreamParser.parse_anthropic_chunk(chunk_json)
                                        else:
                                            parsed = StreamParser.parse_openai_chunk(chunk_json)
                                        
                                        # 累积 thinking(不发送，用于构建下一轮消息)
                                        if parsed.get("thinking"):
                                            assistant_thinking += parsed["thinking"]
                                        
                                        # 发送content增量
                                        if parsed["content"]:
                                            assistant_content += parsed["content"]
                                            yield f"data: {json.dumps({'type': 'content', 'data': parsed['content']})}\n\n"
                                        
                                        # 处理工具调用
                                        if parsed.get("tool_calls") and request.enableTools:
                                            for tool_call in parsed["tool_calls"]:
                                                idx = tool_call.get("index", 0)
                                                if idx not in tool_calls_buffer:
                                                    tool_calls_buffer[idx] = {
                                                        "id": "",
                                                        "name": "",
                                                        "arguments": ""
                                                    }
                                                
                                                if "id" in tool_call:
                                                    tool_calls_buffer[idx]["id"] = tool_call["id"]
                                                
                                                if "function" in tool_call:
                                                    func = tool_call["function"]
                                                    if "name" in func and func["name"] is not None:
                                                        tool_calls_buffer[idx]["name"] += func["name"]
                                                    if "arguments" in func and func["arguments"] is not None:
                                                        tool_calls_buffer[idx]["arguments"] += func["arguments"]
                                        
                                        # 发送tokens统计
                                        if parsed["tokens"] is not None:
                                            yield f"data: {json.dumps({'type': 'tokens', 'data': parsed['tokens']})}\n\n"
                                    
                                    except json.JSONDecodeError:
                                        continue


        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"
