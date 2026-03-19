import json
from typing import Any, AsyncIterator

import httpx

from config import get_web_model_defaults

from .models import ChatRequest
from .providers import MessageBuilder, ProviderConfig
from .stream_parser import (
    ToolCallsAccumulator,
    build_web_search_event,
    extract_sources_from_search_result,
    parse_responses_sse_stream,
    parse_sse_stream,
    summarize_tool_result,
)


class AIService:
    """AI服务主类"""

    @staticmethod
    def _sse_chunk(chunk_type: str, data: Any, *, ensure_ascii: bool = True) -> str:
        return f"data: {json.dumps({'type': chunk_type, 'data': data}, ensure_ascii=ensure_ascii)}\n\n"

    @staticmethod
    def _extract_error_message(error_payload: Any) -> str:
        if isinstance(error_payload, dict):
            error = error_payload.get("error")
            if isinstance(error, dict):
                message = str(error.get("message") or "").strip()
                if message:
                    return message
            for key in ("message", "detail", "error"):
                value = error_payload.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        elif isinstance(error_payload, str) and error_payload.strip():
            return error_payload.strip()
        return ""

    @staticmethod
    def _copy_request_with_defaults(request: ChatRequest) -> ChatRequest:
        defaults = get_web_model_defaults()
        provider = str(request.provider or defaults["provider"] or "openai").strip()
        endpoint_mode = str(
            request.endpointMode or defaults["endpointMode"] or "chat_completions"
        ).strip()
        api_key = str(request.apiKey or defaults["apiKey"] or "").strip()
        api_url = str(request.apiUrl or defaults["apiUrl"] or "").strip() or None
        model = str(request.model or defaults["model"] or "").strip() or None

        update = {
            "provider": provider,
            "endpointMode": endpoint_mode,
            "apiKey": api_key or None,
            "apiUrl": api_url,
            "model": model,
        }
        if hasattr(request, "model_copy"):
            return request.model_copy(update=update)
        return request.copy(update=update)

    @staticmethod
    async def _format_http_error(response: httpx.Response, context: str = "") -> str:
        raw_bytes = await response.aread()
        raw_text = raw_bytes.decode(errors="ignore").strip()
        detail = ""

        try:
            payload = json.loads(raw_text)
        except Exception:
            payload = None

        if payload is not None:
            detail = AIService._extract_error_message(payload)

        if not detail:
            detail = raw_text or response.reason_phrase or ""

        prefix = f"{context} " if context else ""
        if response.status_code in {404, 405, 501}:
            base_message = f"{prefix}当前服务不支持 Responses API 或内置网页搜索".strip()
            if detail and detail.lower() not in {"not found", "method not allowed"}:
                return f"{base_message}: {detail}"
            return base_message

        return f"{prefix}HTTP {response.status_code}: {detail}".strip()

    @staticmethod
    def _merge_sources(
        existing_urls: set[str],
        incoming: list[dict[str, str]] | None,
    ) -> list[dict[str, str]]:
        if not isinstance(incoming, list):
            return []

        merged: list[dict[str, str]] = []
        for source in incoming:
            if not isinstance(source, dict):
                continue
            source_url = str(source.get("url") or "").strip()
            if not source_url or source_url in existing_urls:
                continue
            existing_urls.add(source_url)
            merged.append(
                {
                    "title": str(source.get("title") or "").strip(),
                    "url": source_url,
                }
            )
        return merged

    @staticmethod
    def _clone_responses_input_items(items: Any) -> list[dict[str, object]]:
        if not isinstance(items, list):
            return []

        cloned: list[dict[str, object]] = []
        for item in items:
            if isinstance(item, dict):
                cloned.append(json.loads(json.dumps(item, ensure_ascii=False)))
        return cloned

    @staticmethod
    def _build_responses_manual_followup_items(
        accumulated_input_items: list[dict[str, object]],
        response_output_items: list[dict[str, Any]] | None,
        tool_outputs: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        merged_items = AIService._clone_responses_input_items(accumulated_input_items)
        merged_items.extend(AIService._clone_responses_input_items(response_output_items))
        merged_items.extend(AIService._clone_responses_input_items(tool_outputs))
        return merged_items

    @staticmethod
    def _is_missing_tool_call_error(error_text: str) -> bool:
        normalized = str(error_text or "").strip().lower()
        if not normalized:
            return False
        return (
            "no tool call found for function call output" in normalized
            or "no tool call found for function_call_output" in normalized
        )

    @staticmethod
    def _resolve_max_tool_rounds(value: Any) -> int | None:
        if value is None:
            return None
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            return None
        return normalized if normalized >= 1 else None

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
            request = AIService._copy_request_with_defaults(request)
            if not request.apiKey:
                yield AIService._sse_chunk("error", "缺少 API Key：请在配置中填写，或在服务端设置 PRISM_WEB_DEFAULT_API_KEY")
                return
            if not request.model:
                yield AIService._sse_chunk("error", "缺少模型 ID：请在配置中填写，或在服务端设置 PRISM_WEB_DEFAULT_MODEL")
                return

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
                        error_text = await AIService._format_http_error(response)
                        yield AIService._sse_chunk("error", error_text)
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
                            yield AIService._sse_chunk("thinking", parsed["thinking"])

                        # 发送content增量
                        if parsed.get("content"):
                            assistant_content += parsed["content"]
                            yield AIService._sse_chunk("content", parsed["content"])

                        # 处理工具调用
                        if parsed.get("tool_calls") and request.enableTools:
                            tool_calls_buffer.add(parsed["tool_calls"])

                        # 发送tokens统计
                        if parsed.get("tokens") is not None:
                            yield AIService._sse_chunk("tokens", parsed["tokens"])

                    # 流结束后，如果有工具调用，执行并多轮请求 AI
                    current_round = 0
                    max_rounds = AIService._resolve_max_tool_rounds(
                        request.maxToolRounds
                    )
                    messages_with_tools = body["messages"].copy()

                    while (
                        tool_calls_buffer
                        and request.enableTools
                        and (max_rounds is None or current_round < max_rounds)
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

                            tool_call_id = tool_call["id"] or f"call_{idx}"

                            # 通知前端：开始执行工具
                            yield AIService._sse_chunk(
                                "tool",
                                {
                                    "callId": tool_call_id,
                                    "status": "start",
                                    "round": current_round,
                                    "name": tool_name,
                                    "arguments": args,
                                },
                            )

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
                            yield AIService._sse_chunk(
                                "tool",
                                {
                                    "callId": tool_call_id,
                                    "status": result_status,
                                    "round": current_round,
                                    "name": tool_name,
                                    "resultSummary": result_summary,
                                },
                            )

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
                                            yield AIService._sse_chunk(
                                                "sources",
                                                sources,
                                                ensure_ascii=False,
                                            )

                                        web_search_event = build_web_search_event(
                                            sr, args, current_round, tool_name
                                        )
                                        if web_search_event:
                                            web_search_event["callId"] = tool_call_id
                                            yield AIService._sse_chunk(
                                                "web_search",
                                                web_search_event,
                                                ensure_ascii=False,
                                            )
                                except Exception:
                                    pass

                            # 构建标准格式的 tool_call
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
                                error_text = await AIService._format_http_error(
                                    response_next, "工具调用失败"
                                )
                                yield AIService._sse_chunk("error", error_text)
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
                                    yield AIService._sse_chunk("thinking", parsed["thinking"])

                                # 发送content增量
                                if parsed.get("content"):
                                    assistant_content += parsed["content"]
                                    yield AIService._sse_chunk("content", parsed["content"])

                                # 处理工具调用
                                if parsed.get("tool_calls") and request.enableTools:
                                    tool_calls_buffer.add(parsed["tool_calls"])

                                # 发送tokens统计
                                if parsed.get("tokens") is not None:
                                    yield AIService._sse_chunk("tokens", parsed["tokens"])


                            # 检查是否达到最大轮数限制（若配置了上限）
                            if (
                                max_rounds is not None
                                and current_round >= max_rounds
                                and tool_calls_buffer
                            ):
                                yield AIService._sse_chunk(
                                    "error",
                                    f"已达到最大工具调用轮数限制 ({max_rounds}轮)，停止继续调用工具",
                                )
                                break

        except Exception as e:
            yield AIService._sse_chunk("error", str(e))

    @staticmethod
    async def responses_stream(request: ChatRequest) -> AsyncIterator[str]:
        """OpenAI Responses API 流式接口。"""
        try:
            request = AIService._copy_request_with_defaults(request)
            if not request.apiKey:
                yield AIService._sse_chunk("error", "缺少 API Key：请在配置中填写，或在服务端设置 PRISM_WEB_DEFAULT_API_KEY")
                return
            if not request.model:
                yield AIService._sse_chunk("error", "缺少模型 ID：请在配置中填写，或在服务端设置 PRISM_WEB_DEFAULT_MODEL")
                return

            provider_mode = ProviderConfig.get_provider_mode(request.provider)
            if provider_mode != "openai":
                yield AIService._sse_chunk(
                    "error",
                    "Responses 模式当前只支持 OpenAI 兼容协议",
                )
                return

            api_url = ProviderConfig.get_api_url(
                request.provider,
                request.apiUrl,
                provider_mode,
                endpoint_mode="responses",
            )
            headers = ProviderConfig.build_headers(request.apiKey, provider_mode)

            history_messages = []
            if request.historyTurns:
                history_messages = MessageBuilder.convert_history_to_messages(
                    request.historyTurns,
                    "main",
                    provider_mode,
                )

            current_user_content = MessageBuilder._build_user_content(
                request.prompt,
                request.images,
                provider_mode,
            )
            body = MessageBuilder.build_request_body(
                request,
                provider_mode,
                current_user_content,
                history_messages,
                endpoint_mode="responses",
            )
            responses_tools = list(body.get("tools") or [])
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
                "exa_search_type": str(request.exaSearchType or "auto").lower(),
                "tavily_max_results": request.tavilyMaxResults,
                "tavily_search_depth": request.tavilySearchDepth,
            }
            known_source_urls: set[str] = set()
            search_rounds: dict[str, int] = {}
            next_search_round = 1
            current_round = 0
            max_rounds = AIService._resolve_max_tool_rounds(request.maxToolRounds)
            current_body: dict[str, Any] = dict(body)
            accumulated_input_items = AIService._clone_responses_input_items(
                current_body.get("input")
            )
            pending_manual_followup_items: list[dict[str, object]] | None = None

            async with httpx.AsyncClient(timeout=90.0) as client:
                while True:
                    response_id = ""
                    pending_function_calls: dict[str, dict[str, Any]] = {}
                    response_output_items: list[dict[str, Any]] = []

                    async with client.stream(
                        method="POST",
                        url=api_url,
                        headers=headers,
                        json=current_body,
                    ) as response:
                        if response.status_code >= 400:
                            error_text = await AIService._format_http_error(response)
                            if (
                                pending_manual_followup_items
                                and "previous_response_id" in current_body
                                and AIService._is_missing_tool_call_error(error_text)
                            ):
                                current_body = (
                                    MessageBuilder.build_responses_manual_followup_body(
                                        request,
                                        pending_manual_followup_items,
                                        responses_tools,
                                    )
                                )
                                pending_manual_followup_items = None
                                continue
                            yield AIService._sse_chunk(
                                "error",
                                error_text,
                            )
                            return

                        async for parsed in parse_responses_sse_stream(response):
                            if parsed.get("error"):
                                yield AIService._sse_chunk("error", parsed["error"])
                                return

                            if parsed.get("response_id"):
                                response_id = str(parsed["response_id"]).strip()

                            if isinstance(parsed.get("response_output_items"), list):
                                response_output_items = list(parsed["response_output_items"])

                            if parsed.get("thinking"):
                                yield AIService._sse_chunk("thinking", parsed["thinking"])

                            if parsed.get("content"):
                                yield AIService._sse_chunk("content", parsed["content"])

                            call_id = str(parsed.get("call_id") or "").strip()
                            round_number = None
                            if call_id and parsed.get("tool"):
                                round_number = search_rounds.get(call_id)
                                if round_number is None:
                                    round_number = next_search_round
                                    search_rounds[call_id] = round_number
                                    next_search_round += 1

                            if parsed.get("tool"):
                                tool_payload = dict(parsed["tool"])
                                if round_number is not None:
                                    tool_payload["round"] = round_number
                                yield AIService._sse_chunk(
                                    "tool",
                                    tool_payload,
                                    ensure_ascii=False,
                                )

                            if parsed.get("web_search"):
                                web_search_payload = dict(parsed["web_search"])
                                if round_number is not None:
                                    web_search_payload["round"] = round_number
                                yield AIService._sse_chunk(
                                    "web_search",
                                    web_search_payload,
                                    ensure_ascii=False,
                                )

                            merged_sources = AIService._merge_sources(
                                known_source_urls,
                                parsed.get("sources"),
                            )
                            if merged_sources:
                                yield AIService._sse_chunk(
                                    "sources",
                                    merged_sources,
                                    ensure_ascii=False,
                                )

                            if parsed.get("tokens") is not None:
                                yield AIService._sse_chunk("tokens", parsed["tokens"])

                            function_calls = parsed.get("function_calls")
                            if isinstance(function_calls, list):
                                for function_call in function_calls:
                                    if not isinstance(function_call, dict):
                                        continue
                                    resolved_call_id = str(
                                        function_call.get("call_id")
                                        or function_call.get("id")
                                        or ""
                                    ).strip()
                                    if not resolved_call_id:
                                        continue
                                    pending_function_calls[resolved_call_id] = function_call

                    if not pending_function_calls:
                        break

                    current_round += 1
                    if max_rounds is not None and current_round > max_rounds:
                        yield AIService._sse_chunk(
                            "error",
                            f"已达到最大工具调用轮数限制 ({max_rounds}轮)，停止继续调用工具",
                        )
                        return

                    tool_outputs: list[dict[str, object]] = []
                    for function_call in pending_function_calls.values():
                        tool_name = str(function_call.get("name") or "").strip()
                        if not tool_name:
                            continue

                        raw_arguments = str(function_call.get("arguments") or "")
                        try:
                            args = json.loads(raw_arguments) if raw_arguments else {}
                        except Exception:
                            args = {}
                        if not isinstance(args, dict):
                            args = {}

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
                            allowed_exa_types = {
                                "neural",
                                "fast",
                                "auto",
                                "deep",
                                "deep-reasoning",
                                "deep-max",
                                "instant",
                            }
                            resolved_exa_type = str(request.exaSearchType or "auto").lower()
                            args["search_type"] = (
                                resolved_exa_type
                                if resolved_exa_type in allowed_exa_types
                                else "auto"
                            )

                        yield AIService._sse_chunk(
                            "tool",
                            {
                                "callId": str(
                                    function_call.get("call_id")
                                    or function_call.get("id")
                                    or ""
                                ).strip(),
                                "status": "start",
                                "round": current_round,
                                "name": tool_name,
                                "arguments": args,
                            },
                            ensure_ascii=False,
                        )

                        result = await AIService.execute_tool(
                            tool_name,
                            args,
                            tool_runtime_context,
                        )
                        result_status, result_summary, parsed_result_dict = (
                            summarize_tool_result(result)
                        )
                        yield AIService._sse_chunk(
                            "tool",
                            {
                                "callId": str(
                                    function_call.get("call_id")
                                    or function_call.get("id")
                                    or ""
                                ).strip(),
                                "status": result_status,
                                "round": current_round,
                                "name": tool_name,
                                "resultSummary": result_summary,
                            },
                            ensure_ascii=False,
                        )

                        if result_status == "success" and tool_name in (
                            "tavily_search",
                            "exa_search",
                        ):
                            try:
                                search_result = parsed_result_dict
                                if not isinstance(search_result, dict):
                                    search_result = json.loads(result)
                                if isinstance(search_result, dict):
                                    merged_sources = AIService._merge_sources(
                                        known_source_urls,
                                        extract_sources_from_search_result(search_result),
                                    )
                                    if merged_sources:
                                        yield AIService._sse_chunk(
                                            "sources",
                                            merged_sources,
                                            ensure_ascii=False,
                                        )

                                    web_search_event = build_web_search_event(
                                        search_result,
                                        args,
                                        current_round,
                                        tool_name,
                                    )
                                    if web_search_event:
                                        web_search_event["callId"] = str(
                                            function_call.get("call_id")
                                            or function_call.get("id")
                                            or ""
                                        ).strip()
                                        yield AIService._sse_chunk(
                                            "web_search",
                                            web_search_event,
                                            ensure_ascii=False,
                                        )
                            except Exception:
                                pass

                        tool_outputs.append(
                            {
                                "type": "function_call_output",
                                "call_id": str(
                                    function_call.get("call_id")
                                    or function_call.get("id")
                                    or ""
                                ).strip(),
                                "output": result,
                            }
                        )

                    if not tool_outputs:
                        yield AIService._sse_chunk(
                            "error",
                            "模型返回了无法执行的工具调用",
                        )
                        return

                    if not response_id:
                        pending_manual_followup_items = (
                            AIService._build_responses_manual_followup_items(
                                accumulated_input_items,
                                response_output_items,
                                tool_outputs,
                            )
                        )
                        current_body = MessageBuilder.build_responses_manual_followup_body(
                            request,
                            pending_manual_followup_items,
                            responses_tools,
                        )
                        accumulated_input_items = (
                            AIService._clone_responses_input_items(
                                pending_manual_followup_items
                            )
                        )
                        continue

                    pending_manual_followup_items = (
                        AIService._build_responses_manual_followup_items(
                            accumulated_input_items,
                            response_output_items,
                            tool_outputs,
                        )
                    )
                    current_body = MessageBuilder.build_responses_followup_body(
                        request,
                        response_id,
                        tool_outputs,
                        responses_tools,
                    )
                    accumulated_input_items = AIService._clone_responses_input_items(
                        pending_manual_followup_items
                    )

        except Exception as e:
            yield AIService._sse_chunk("error", str(e))
