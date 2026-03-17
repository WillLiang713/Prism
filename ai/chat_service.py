import json
from typing import Any, AsyncIterator

import httpx

from .models import ChatRequest
from .providers import MessageBuilder, ProviderConfig
from .stream_parser import (
    ToolCallsAccumulator,
    build_web_search_event,
    extract_sources_from_search_result,
    parse_sse_stream,
    summarize_tool_result,
)


class AIService:
    """AI服务主类"""

    @staticmethod
    async def execute_tool(
        tool_name: str, arguments: dict, runtime_context: dict[str, Any] | None = None
    ) -> str:
        """执行工具调用"""
        from tools import (
            execute_tool as sync_execute_tool,
            reset_runtime_context,
            set_runtime_context,
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
            api_url = ProviderConfig.get_api_url(
                request.provider, request.apiUrl, provider_mode
            )

            # 构建请求头
            headers = ProviderConfig.build_headers(request.apiKey, provider_mode)

            # 构建历史消息
            history_messages = []
            if request.historyTurns:
                history_messages = MessageBuilder.convert_history_to_messages(
                    request.historyTurns, "main", provider_mode
                )

            # 构建当前用户消息
            current_user_content = MessageBuilder._build_user_content(
                request.prompt, request.images, provider_mode
            )

            # 构建请求体
            body = MessageBuilder.build_request_body(
                request, provider_mode, current_user_content, history_messages
            )

            # 发起流式请求
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    method="POST", url=api_url, headers=headers, json=body
                ) as response:
                    if response.status_code >= 400:
                        error_text = await response.aread()
                        yield f"data: {json.dumps({'type': 'error', 'data': f'HTTP {response.status_code}: {error_text.decode()}'})}\n\n"
                        return

                    tool_calls_buffer = ToolCallsAccumulator()
                    assistant_thinking = ""
                    assistant_content = ""
                    assistant_blocks: list[dict[str, Any]] = []

                    async for parsed in parse_sse_stream(response, provider_mode):
                        if provider_mode == "anthropic" and parsed.get("completed_block"):
                            assistant_blocks.append(parsed["completed_block"])

                        # 发送thinking增量
                        if parsed.get("thinking"):
                            assistant_thinking += parsed["thinking"]
                            yield f"data: {json.dumps({'type': 'thinking', 'data': parsed['thinking']})}\n\n"

                        # 发送content增量
                        if parsed.get("content"):
                            assistant_content += parsed["content"]
                            yield f"data: {json.dumps({'type': 'content', 'data': parsed['content']})}\n\n"

                        # 处理工具调用
                        if parsed.get("tool_calls") and request.enableTools:
                            tool_calls_buffer.add(parsed["tool_calls"])

                        # 发送tokens统计
                        if parsed.get("tokens") is not None:
                            yield f"data: {json.dumps({'type': 'tokens', 'data': parsed['tokens']})}\n\n"

                    # 流结束后，如果有工具调用，执行并多轮请求 AI
                    current_round = 0
                    max_rounds = min(request.maxToolRounds, 200)
                    messages_with_tools = body["messages"].copy()

                    while (
                        tool_calls_buffer
                        and request.enableTools
                        and current_round < max_rounds
                    ):
                        current_round += 1
                        resolved_max_results = (
                            request.webSearchMaxResults or request.tavilyMaxResults or 5
                        )
                        tool_runtime_context = {
                            "web_search_provider": str(
                                request.webSearchProvider or "tavily"
                            ).lower(),
                            "web_search_max_results": resolved_max_results,
                            "tavily_api_key": (request.tavilyApiKey or "").strip(),
                            "exa_api_key": (request.exaApiKey or "").strip(),
                            "exa_search_type": str(
                                request.exaSearchType or "auto"
                            ).lower(),
                            "tavily_max_results": request.tavilyMaxResults,
                            "tavily_search_depth": request.tavilySearchDepth,
                        }

                        # 构建工具调用消息
                        assistant_message: dict[str, Any] | None = None
                        anthropic_tool_results: list[dict[str, Any]] = []
                        if provider_mode == "anthropic":
                            assistant_message = {
                                "role": "assistant",
                                "content": list(assistant_blocks),
                            }
                            use_synthetic_anthropic_blocks = (
                                len(assistant_message["content"]) == 0
                            )
                        else:
                            assistant_message = {
                                "role": "assistant",
                                "tool_calls": [],
                            }
                            use_synthetic_anthropic_blocks = False

                            # 为 DeepSeek 等模型添加必需的字段
                            if assistant_content:
                                assistant_message["content"] = assistant_content
                            if assistant_thinking:
                                model_lower = request.model.lower()
                                if "deepseek" in model_lower:
                                    assistant_message["reasoning_content"] = (
                                        assistant_thinking
                                    )
                                elif "o1" in model_lower:
                                    assistant_message["reasoning_content"] = (
                                        assistant_thinking
                                    )

                        # 过滤无效的 tool_calls（name 为空）
                        valid_tool_calls = tool_calls_buffer.valid_calls()
                        if not valid_tool_calls:
                            break

                        tool_results = []
                        for idx, tool_call in sorted(valid_tool_calls.items()):
                            tool_name = tool_call["name"]
                            parsed_result_dict: dict[str, Any] | None = None
                            try:
                                args = (
                                    json.loads(tool_call["arguments"])
                                    if tool_call["arguments"]
                                    else {}
                                )
                            except Exception:
                                args = {}
                            if not isinstance(args, dict):
                                args = {}

                            # 对 Tavily 搜索强制使用前端配置的默认深度，
                            # 忽略模型在本轮 tool call 中显式给出的 search_depth。
                            if tool_name == "tavily_search":
                                resolved_depth = (
                                    "advanced"
                                    if str(request.tavilySearchDepth).lower()
                                    == "advanced"
                                    else "basic"
                                )
                                args["search_depth"] = resolved_depth
                                args["max_results"] = resolved_max_results
                            elif tool_name == "exa_search":
                                args["max_results"] = resolved_max_results
                                allowed_exa_types = {
                                    "neural",
                                    "fast",
                                    "auto",
                                    "deep",
                                    "deep-reasoning",
                                    "deep-max",
                                    "instant",
                                }
                                resolved_exa_type = str(
                                    request.exaSearchType or "auto"
                                ).lower()
                                args["search_type"] = (
                                    resolved_exa_type
                                    if resolved_exa_type in allowed_exa_types
                                    else "auto"
                                )

                            # 通知前端：开始执行工具
                            yield f"data: {json.dumps({'type': 'tool', 'data': {'status': 'start', 'round': current_round, 'name': tool_name, 'arguments': args}})}\n\n"

                            # 执行工具
                            result = await AIService.execute_tool(
                                tool_name,
                                args,
                                tool_runtime_context,
                            )

                            # 通知前端：工具执行结果摘要
                            (
                                result_status,
                                result_summary,
                                parsed_result_dict,
                            ) = summarize_tool_result(result)
                            yield f"data: {json.dumps({'type': 'tool', 'data': {'status': result_status, 'round': current_round, 'name': tool_name, 'resultSummary': result_summary}})}\n\n"

                            # 如果是搜索工具且成功，提取来源链接单独发送
                            if result_status == "success" and tool_name in (
                                "tavily_search",
                                "exa_search",
                            ):
                                try:
                                    sr = parsed_result_dict
                                    if not isinstance(sr, dict):
                                        sr = json.loads(result)
                                    if isinstance(sr, dict):
                                        sources = extract_sources_from_search_result(sr)
                                        if sources:
                                            yield f"data: {json.dumps({'type': 'sources', 'data': sources}, ensure_ascii=False)}\n\n"

                                        web_search_event = build_web_search_event(
                                            sr, args, current_round, tool_name
                                        )
                                        if web_search_event:
                                            yield f"data: {json.dumps({'type': 'web_search', 'data': web_search_event}, ensure_ascii=False)}\n\n"
                                except Exception:
                                    pass

                            # 构建标准格式的 tool_call
                            tool_call_id = tool_call["id"] or f"call_{idx}"
                            if provider_mode == "anthropic":
                                if use_synthetic_anthropic_blocks:
                                    assistant_content_blocks = assistant_message.get(
                                        "content", []
                                    )
                                    if not assistant_content_blocks and assistant_content:
                                        assistant_content_blocks.append(
                                            {
                                                "type": "text",
                                                "text": assistant_content,
                                            }
                                        )
                                    assistant_content_blocks.append(
                                        {
                                            "type": "tool_use",
                                            "id": tool_call_id,
                                            "name": tool_name,
                                            "input": args,
                                        }
                                    )
                                anthropic_tool_result = {
                                    "type": "tool_result",
                                    "tool_use_id": tool_call_id,
                                    "content": result,
                                }
                                if result_status == "error":
                                    anthropic_tool_result["is_error"] = True
                                anthropic_tool_results.append(anthropic_tool_result)
                            else:
                                assistant_message["tool_calls"].append(
                                    {
                                        "id": tool_call_id,
                                        "type": "function",
                                        "function": {
                                            "name": tool_name,
                                            "arguments": tool_call["arguments"],
                                        },
                                    }
                                )

                                # 构建工具结果消息
                                tool_results.append(
                                    {
                                        "role": "tool",
                                        "tool_call_id": tool_call_id,
                                        "content": result,
                                    }
                                )

                        # 追加工具调用和结果到消息列表
                        if provider_mode == "anthropic":
                            assistant_content_blocks = (
                                assistant_message.get("content", [])
                                if isinstance(assistant_message, dict)
                                else []
                            )
                            if not assistant_content_blocks and assistant_content:
                                assistant_content_blocks.append(
                                    {"type": "text", "text": assistant_content}
                                )
                            if assistant_message and assistant_content_blocks:
                                messages_with_tools.append(assistant_message)
                            if anthropic_tool_results:
                                messages_with_tools.append(
                                    {
                                        "role": "user",
                                        "content": anthropic_tool_results,
                                    }
                                )
                        else:
                            messages_with_tools.append(assistant_message)
                            messages_with_tools.extend(tool_results)

                        # 清空并准备下一轮
                        tool_calls_buffer.clear()
                        assistant_thinking = ""
                        assistant_content = ""
                        assistant_blocks = []

                        # 再次请求 AI
                        body_next = body.copy()
                        body_next["messages"] = messages_with_tools
                        # 保留 tools 定义，允许 AI 继续调用工具

                        # 发送下一轮请求
                        async with client.stream(
                            method="POST", url=api_url, headers=headers, json=body_next
                        ) as response_next:
                            if response_next.status_code >= 400:
                                error_text = await response_next.aread()
                                yield f"data: {json.dumps({'type': 'error', 'data': f'工具调用失败 HTTP {response_next.status_code}: {error_text.decode()}'})}\n\n"
                                return

                            async for parsed in parse_sse_stream(
                                response_next, provider_mode
                            ):
                                if provider_mode == "anthropic" and parsed.get(
                                    "completed_block"
                                ):
                                    assistant_blocks.append(parsed["completed_block"])

                                # 累积 thinking 并继续推给前端
                                if parsed.get("thinking"):
                                    assistant_thinking += parsed["thinking"]
                                    yield f"data: {json.dumps({'type': 'thinking', 'data': parsed['thinking']})}\n\n"

                                # 发送content增量
                                if parsed.get("content"):
                                    assistant_content += parsed["content"]
                                    yield f"data: {json.dumps({'type': 'content', 'data': parsed['content']})}\n\n"

                                # 处理工具调用
                                if parsed.get("tool_calls") and request.enableTools:
                                    tool_calls_buffer.add(parsed["tool_calls"])

                                # 发送tokens统计
                                if parsed.get("tokens") is not None:
                                    yield f"data: {json.dumps({'type': 'tokens', 'data': parsed['tokens']})}\n\n"


                            # 检查是否达到最大轮数限制
                            if current_round >= max_rounds and tool_calls_buffer:
                                yield f"data: {json.dumps({'type': 'error', 'data': f'已达到最大工具调用轮数限制 ({max_rounds}轮)，停止继续调用工具'})}\n\n"
                                break

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"
