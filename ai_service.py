"""
AI服务模块

封装与AI提供商交互的核心逻辑:
1. 请求构建 (支持OpenAI和Anthropic格式)
2. 流式响应处理
3. 多模态支持 (文本+图片)
4. 对话历史管理
"""

from typing import Any, AsyncIterator, Literal
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
    customFormat: str = Field(default="openai")
    apiKey: str
    model: str
    apiUrl: str | None = None

    # 消息内容
    prompt: str
    images: list[ImageContent] = []
    systemPrompt: str | None = None

    # 功能开关
    thinking: bool = False
    enableHistory: bool = True
    maxHistoryTurns: int = Field(default=10, ge=1, le=50)
    enableTools: bool = False  # 是否启用工具调用
    maxToolRounds: int = Field(default=5, ge=1, le=20)  # 最大工具调用轮数

    # 历史对话
    historyTurns: list[HistoryTurn] = []
    side: Literal["A", "B"] = "A"


class StreamChunk(BaseModel):
    """流式响应块"""
    type: Literal["thinking", "content", "tokens", "error"]
    data: str | int


# ==================== 提供商配置 ====================

class ProviderConfig:
    """AI提供商配置"""

    DEFAULT_URLS = {
        "openai": "https://api.openai.com/v1/chat/completions",
        "anthropic": "https://api.anthropic.com/v1/messages"
    }

    @staticmethod
    def get_provider_mode(provider: str, custom_format: str) -> str:
        """判断提供商模式"""
        provider = provider.strip().lower()
        custom_format = custom_format.strip().lower()

        if provider == "anthropic" or (provider == "custom" and custom_format == "anthropic"):
            return "anthropic"
        return "openai"

    @staticmethod
    def get_api_url(provider: str, api_url: str | None, provider_mode: str) -> str:
        """获取API地址，自动拼接v1路径"""
        url = (api_url or "").strip()

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

    @staticmethod
    def convert_history_to_messages(
        history_turns: list[HistoryTurn],
        side: str,
        provider_mode: str,
        max_turns: int
    ) -> list[dict]:
        """将历史turns转换为消息数组"""
        if not history_turns:
            return []

        recent_turns = history_turns[-max_turns:] if max_turns > 0 else history_turns
        messages = []

        for turn in recent_turns:
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

        # 系统提示词
        if config.systemPrompt and config.systemPrompt.strip():
            body["system"] = config.systemPrompt.strip()

        # 思考模式
        if config.thinking:
            body["thinking"] = {"type": "enabled", "budget_tokens": 2000}

        return body

    @staticmethod
    def _build_openai_body(
        config: ChatRequest,
        user_content: str | list[dict],
        history_messages: list[dict]
    ) -> dict:
        """构建OpenAI格式请求体"""
        messages = []

        # 系统提示词
        if config.systemPrompt and config.systemPrompt.strip():
            messages.append({"role": "system", "content": config.systemPrompt.strip()})

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
                    tools = json.load(f)
                    if tools:
                        body["tools"] = tools
            except Exception:
                pass

        # 思考模式(针对特定模型)
        if config.thinking:
            model_lower = config.model.lower()
            if "o1" in model_lower:
                body["reasoning_effort"] = "high"
            elif "qwen" in model_lower:
                body["enable_thinking"] = True
            elif "deepseek" in model_lower:
                body["thinking"] = {"type": "enabled"}

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

            # 思考内容(不同模型字段不同)
            if "reasoning_content" in delta:
                result["thinking"] = delta["reasoning_content"]
            elif "thinking" in delta:
                result["thinking"] = delta["thinking"]
            elif "reasoning" in delta:
                result["reasoning"] = delta["reasoning"]

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
    async def execute_tool(tool_name: str, arguments: dict) -> str:
        """执行工具调用"""
        from tools import execute_tool as sync_execute_tool
        return sync_execute_tool(tool_name, arguments)

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
            provider_mode = ProviderConfig.get_provider_mode(
                request.provider,
                request.customFormat
            )

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
            if request.enableHistory and request.historyTurns:
                history_messages = MessageBuilder.convert_history_to_messages(
                    request.historyTurns,
                    request.side,
                    provider_mode,
                    request.maxHistoryTurns
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
                    
                    while tool_calls_buffer and request.enableTools and current_round < request.maxToolRounds:
                        current_round += 1
                        
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
                            
                            # 执行工具
                            result = await AIService.execute_tool(tool_name, args)
                            
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
