import json
from typing import Any, AsyncIterator

import httpx

from ..builders import PreparedConversation, prepare_conversation
from ..compat import create_stream_compat_adapter
from ..models import ChatRequest
from ..parsers import (
    ToolCallsAccumulator,
    build_anthropic_web_search_event,
    build_web_search_event,
    build_web_search_event_from_grounding,
    extract_sources_from_anthropic_content_block,
    extract_sources_from_grounding_metadata,
    extract_sources_from_search_result,
    summarize_tool_result,
)
from ..providers import get_provider_adapter, is_grok_proxy


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
    def _normalize_request(request: ChatRequest) -> ChatRequest:
        provider = str(request.provider or "openai").strip()
        endpoint_mode = str(request.endpointMode or "chat_completions").strip()
        api_key = str(request.apiKey or "").strip()
        api_url = str(request.apiUrl or "").strip() or None
        model = str(request.model or "").strip() or None

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
        tool_name: str,
        arguments: dict,
        runtime_context: dict[str, Any] | None = None,
    ) -> str:
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
    def _custom_tool_calls_enabled(request: ChatRequest, provider_mode: str) -> bool:
        if not request.enableTools:
            return False
        if provider_mode != "gemini":
            return True
        return not request.enableGoogleSearch

    @staticmethod
    def _build_tool_runtime_context(request: ChatRequest) -> dict[str, Any]:
        resolved_max_results = request.webSearchMaxResults or request.tavilyMaxResults or 5
        return {
            "web_search_provider": str(request.webSearchProvider or "tavily").lower(),
            "web_search_max_results": resolved_max_results,
            "tavily_api_key": (request.tavilyApiKey or "").strip(),
            "exa_api_key": (request.exaApiKey or "").strip(),
            "exa_search_type": str(request.exaSearchType or "auto").lower(),
            "tavily_max_results": request.tavilyMaxResults,
            "tavily_search_depth": request.tavilySearchDepth,
        }

    @staticmethod
    def _normalize_tool_arguments(
        tool_name: str,
        raw_arguments: str,
        request: ChatRequest,
    ) -> tuple[dict[str, Any], int]:
        try:
            args = json.loads(raw_arguments) if raw_arguments else {}
        except Exception:
            args = {}

        if not isinstance(args, dict):
            args = {}

        resolved_max_results = request.webSearchMaxResults or request.tavilyMaxResults or 5
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
                resolved_exa_type if resolved_exa_type in allowed_exa_types else "auto"
            )

        return args, resolved_max_results

    @staticmethod
    def _normalize_function_response_payload(result: str) -> dict[str, Any]:
        try:
            parsed = json.loads(result)
        except Exception:
            return {"content": str(result or "")}

        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"items": parsed}
        return {"content": str(parsed)}

    @staticmethod
    def _append_gemini_model_parts(
        existing_parts: list[dict[str, Any]],
        new_parts: list[dict[str, Any]],
    ) -> None:
        for part in new_parts:
            if isinstance(part, dict):
                existing_parts.append(dict(part))

    @staticmethod
    def _append_assistant_images(
        existing_images: list[dict[str, str]],
        new_images: list[dict[str, Any]],
    ) -> list[dict[str, str]]:
        seen_urls = {
            str(item.get("url") or "").strip()
            for item in existing_images
            if isinstance(item, dict)
        }
        appended: list[dict[str, str]] = []

        for item in new_images:
            if not isinstance(item, dict):
                continue
            image_url = str(item.get("url") or "").strip()
            if not image_url or image_url in seen_urls:
                continue
            seen_urls.add(image_url)
            normalized = {"url": image_url}
            existing_images.append(normalized)
            appended.append(normalized)

        return appended

    @staticmethod
    def _build_round_state() -> dict[str, Any]:
        return {
            "assistant_thinking": "",
            "assistant_content": "",
            "assistant_images": [],
            "assistant_blocks": [],
            "gemini_model_parts": [],
            "grounding_urls": set(),
            "web_search_keys": set(),
            "stop_reason": "",
        }

    @staticmethod
    def _prepare_conversation(
        request: ChatRequest,
        provider_mode: str,
    ) -> PreparedConversation:
        return prepare_conversation(
            request,
            provider_mode,
            is_grok_proxy=is_grok_proxy(request.apiUrl, request.model),
        )

    @staticmethod
    def _build_chat_transport(
        request: ChatRequest,
        *,
        endpoint_mode: str = "chat_completions",
    ) -> tuple[ChatRequest, Any, PreparedConversation, str, dict[str, str], dict[str, Any]]:
        normalized_request = AIService._normalize_request(request)
        adapter = get_provider_adapter(normalized_request.provider)
        prepared = AIService._prepare_conversation(
            normalized_request,
            adapter.provider_mode,
        )
        api_url = adapter.build_api_url(
            normalized_request.provider,
            normalized_request.apiUrl,
            normalized_request.model,
            stream=True,
            endpoint_mode=endpoint_mode,
        )
        headers = adapter.build_headers(str(normalized_request.apiKey or ""))
        if endpoint_mode == "responses":
            body = adapter.build_responses_body(
                normalized_request,
                prepared.current_user_content,
                prepared.history_messages,
            )
        else:
            body = adapter.build_chat_body(
                normalized_request,
                prepared.current_user_content,
                prepared.history_messages,
            )
        return normalized_request, adapter, prepared, api_url, headers, body

    @staticmethod
    async def _stream_round(
        response: httpx.Response,
        adapter: Any,
        request: ChatRequest,
        current_round: int,
        tool_calls_buffer: ToolCallsAccumulator,
        round_state: dict[str, Any],
    ) -> AsyncIterator[str]:
        provider_mode = adapter.provider_mode
        custom_tool_calls_enabled = AIService._custom_tool_calls_enabled(
            request, provider_mode
        )
        compat_adapter = create_stream_compat_adapter(request, current_round)

        async for parsed in adapter.parse_chat_stream(response):
            if provider_mode == "anthropic" and parsed.get("completed_block"):
                completed_block = parsed["completed_block"]
                round_state["assistant_blocks"].append(completed_block)

                fresh_sources = AIService._merge_sources(
                    round_state["grounding_urls"],
                    extract_sources_from_anthropic_content_block(completed_block),
                )
                if fresh_sources:
                    yield AIService._sse_chunk(
                        "sources",
                        fresh_sources,
                        ensure_ascii=False,
                    )

                web_search_event = build_anthropic_web_search_event(
                    completed_block,
                    current_round,
                )
                if web_search_event:
                    yield AIService._sse_chunk(
                        "web_search",
                        web_search_event,
                        ensure_ascii=False,
                    )
                    yield AIService._sse_chunk(
                        "tool",
                        {
                            "callId": str(web_search_event.get("callId") or "").strip(),
                            "status": (
                                "error"
                                if web_search_event.get("status") == "error"
                                else "success"
                            ),
                            "round": current_round,
                            "name": str(web_search_event.get("name") or "web_search"),
                            "resultSummary": (
                                str(web_search_event.get("error") or "").strip()
                                if web_search_event.get("status") == "error"
                                else (
                                    f"返回 {int(web_search_event.get('totalResults') or 0)} 条结果"
                                    if int(web_search_event.get("totalResults") or 0) > 0
                                    else "搜索完成"
                                )
                            ),
                        },
                    )

            if provider_mode == "gemini" and parsed.get("model_parts"):
                AIService._append_gemini_model_parts(
                    round_state["gemini_model_parts"], parsed["model_parts"]
                )

            if parsed.get("thinking"):
                round_state["assistant_thinking"] += parsed["thinking"]
                yield AIService._sse_chunk(
                    "thinking",
                    parsed["thinking"],
                    ensure_ascii=False,
                )

            if parsed.get("content"):
                if compat_adapter is None:
                    round_state["assistant_content"] += parsed["content"]
                    yield AIService._sse_chunk(
                        "content",
                        parsed["content"],
                        ensure_ascii=False,
                    )
                else:
                    compat_output = compat_adapter.process_content(parsed["content"])
                    for thinking_chunk in compat_output["thinking"]:
                        round_state["assistant_thinking"] += thinking_chunk
                        yield AIService._sse_chunk(
                            "thinking",
                            thinking_chunk,
                            ensure_ascii=False,
                        )
                    for web_search_event in compat_output["web_search"]:
                        yield AIService._sse_chunk(
                            "web_search",
                            web_search_event,
                            ensure_ascii=False,
                        )
                    for content_chunk in compat_output["content"]:
                        round_state["assistant_content"] += content_chunk
                        yield AIService._sse_chunk(
                            "content",
                            content_chunk,
                            ensure_ascii=False,
                        )

            if isinstance(parsed.get("images"), list):
                fresh_images = AIService._append_assistant_images(
                    round_state["assistant_images"], parsed["images"]
                )
                if fresh_images:
                    yield AIService._sse_chunk("images", fresh_images)

            if parsed.get("tool_calls") and custom_tool_calls_enabled:
                tool_calls_buffer.add(parsed["tool_calls"])

            if parsed.get("tool"):
                tool_payload = dict(parsed["tool"])
                tool_payload.setdefault("round", current_round)
                yield AIService._sse_chunk("tool", tool_payload)

            if parsed.get("sources"):
                fresh_sources = AIService._merge_sources(
                    round_state["grounding_urls"],
                    parsed["sources"],
                )
                if fresh_sources:
                    yield AIService._sse_chunk(
                        "sources",
                        fresh_sources,
                        ensure_ascii=False,
                    )

            if parsed.get("web_search"):
                web_search_payload = dict(parsed["web_search"])
                web_search_payload.setdefault("round", current_round)
                yield AIService._sse_chunk(
                    "web_search",
                    web_search_payload,
                    ensure_ascii=False,
                )

            if parsed.get("tokens") is not None:
                yield AIService._sse_chunk("tokens", parsed["tokens"])

            if parsed.get("stop_reason"):
                round_state["stop_reason"] = str(parsed["stop_reason"])

            if provider_mode == "gemini":
                grounding_metadata = parsed.get("grounding_metadata")
                if isinstance(grounding_metadata, dict):
                    sources = extract_sources_from_grounding_metadata(
                        grounding_metadata
                    )
                    fresh_sources = []
                    for source in sources:
                        source_url = str(source.get("url") or "").strip()
                        if not source_url or source_url in round_state["grounding_urls"]:
                            continue
                        round_state["grounding_urls"].add(source_url)
                        fresh_sources.append(source)
                    if fresh_sources:
                        yield AIService._sse_chunk(
                            "sources",
                            fresh_sources,
                            ensure_ascii=False,
                        )

                    web_search_event = build_web_search_event_from_grounding(
                        grounding_metadata, current_round
                    )
                    if web_search_event:
                        search_key = (
                            str(web_search_event.get("query") or ""),
                            tuple(
                                str(item.get("url") or "")
                                for item in web_search_event.get("results", [])
                            ),
                        )
                        if search_key not in round_state["web_search_keys"]:
                            round_state["web_search_keys"].add(search_key)
                            yield AIService._sse_chunk(
                                "web_search",
                                web_search_event,
                                ensure_ascii=False,
                            )
                            yield AIService._sse_chunk(
                                "tool",
                                {
                                    "callId": str(
                                        web_search_event.get("callId") or ""
                                    ).strip(),
                                    "status": (
                                        "error"
                                        if web_search_event.get("status") == "error"
                                        else "success"
                                    ),
                                    "round": current_round,
                                    "name": str(
                                        web_search_event.get("name") or "web_search"
                                    ),
                                    "resultSummary": (
                                        str(web_search_event.get("error") or "").strip()
                                        if web_search_event.get("status") == "error"
                                        else (
                                            f"返回 {int(web_search_event.get('totalResults') or 0)} 条结果"
                                            if int(web_search_event.get("totalResults") or 0)
                                            > 0
                                            else "搜索完成"
                                        )
                                    ),
                                },
                            )

        if compat_adapter is not None:
            compat_flush = compat_adapter.flush()
            for thinking_chunk in compat_flush["thinking"]:
                round_state["assistant_thinking"] += thinking_chunk
                yield AIService._sse_chunk(
                    "thinking",
                    thinking_chunk,
                    ensure_ascii=False,
                )
            for web_search_event in compat_flush["web_search"]:
                yield AIService._sse_chunk(
                    "web_search",
                    web_search_event,
                    ensure_ascii=False,
                )
            for content_chunk in compat_flush["content"]:
                round_state["assistant_content"] += content_chunk
                yield AIService._sse_chunk(
                    "content",
                    content_chunk,
                    ensure_ascii=False,
                )

    @staticmethod
    async def chat_stream(request: ChatRequest) -> AsyncIterator[str]:
        try:
            request = AIService._normalize_request(request)
            if not request.apiKey:
                yield AIService._sse_chunk("error", "缺少 API Key：请先在配置中填写")
                return
            if not request.model:
                yield AIService._sse_chunk("error", "缺少模型 ID：请先在配置中填写")
                return

            request, adapter, _, api_url, headers, body = AIService._build_chat_transport(
                request
            )
            provider_mode = adapter.provider_mode

            async with httpx.AsyncClient(timeout=60.0) as client:
                tool_calls_buffer = ToolCallsAccumulator()
                round_state = AIService._build_round_state()

                async with client.stream(
                    method="POST",
                    url=api_url,
                    headers=headers,
                    json=body,
                ) as response:
                    if response.status_code >= 400:
                        error_text = await AIService._format_http_error(response)
                        yield AIService._sse_chunk("error", error_text)
                        return
                    async for event in AIService._stream_round(
                        response,
                        adapter,
                        request,
                        0,
                        tool_calls_buffer,
                        round_state,
                    ):
                        yield event

                current_round = 0
                max_rounds = AIService._resolve_max_tool_rounds(request.maxToolRounds)
                messages_with_tools = adapter.build_messages_buffer(body)
                anthropic_pause_turns = 0
                max_anthropic_pause_turns = 4

                while True:
                    should_continue_anthropic_pause = (
                        provider_mode == "anthropic"
                        and str(round_state.get("stop_reason") or "") == "pause_turn"
                        and not tool_calls_buffer
                    )
                    if should_continue_anthropic_pause:
                        if anthropic_pause_turns >= max_anthropic_pause_turns:
                            yield AIService._sse_chunk(
                                "error",
                                "Anthropic 内置搜索暂停次数过多，已停止继续请求",
                            )
                            break

                        anthropic_pause_turns += 1
                        pause_messages = adapter.build_tool_followup_messages(
                            request,
                            round_state,
                            {},
                            [],
                        )
                        if not pause_messages:
                            break

                        messages_with_tools.extend(pause_messages)
                        tool_calls_buffer.clear()
                        round_state = AIService._build_round_state()
                        body = adapter.build_next_body(body, messages_with_tools)

                        async with client.stream(
                            method="POST",
                            url=api_url,
                            headers=headers,
                            json=body,
                        ) as response_next:
                            if response_next.status_code >= 400:
                                error_text = await AIService._format_http_error(
                                    response_next,
                                    "Anthropic 内置搜索继续失败",
                                )
                                yield AIService._sse_chunk("error", error_text)
                                return

                            async for event in AIService._stream_round(
                                response_next,
                                adapter,
                                request,
                                current_round,
                                tool_calls_buffer,
                                round_state,
                            ):
                                yield event
                        continue

                    if not (
                        tool_calls_buffer
                        and AIService._custom_tool_calls_enabled(request, provider_mode)
                        and (max_rounds is None or current_round < max_rounds)
                    ):
                        break

                    current_round += 1
                    valid_tool_calls = tool_calls_buffer.valid_calls()
                    if not valid_tool_calls:
                        break

                    tool_runtime_context = AIService._build_tool_runtime_context(request)
                    executed_tools: list[dict[str, Any]] = []

                    for idx, tool_call in sorted(valid_tool_calls.items()):
                        tool_name = tool_call["name"]
                        tool_call_id = tool_call["id"] or f"call_{idx}"
                        raw_arguments = tool_call.get("arguments") or ""
                        args, _ = AIService._normalize_tool_arguments(
                            tool_name,
                            raw_arguments,
                            request,
                        )

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
                                "callId": tool_call_id,
                                "status": result_status,
                                "round": current_round,
                                "name": tool_name,
                                "resultSummary": result_summary,
                            },
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
                                    sources = extract_sources_from_search_result(search_result)
                                    if sources:
                                        yield AIService._sse_chunk(
                                            "sources",
                                            sources,
                                            ensure_ascii=False,
                                        )

                                    web_search_event = build_web_search_event(
                                        search_result,
                                        args,
                                        current_round,
                                        tool_name,
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

                        executed_tools.append(
                            {
                                "call_id": tool_call_id,
                                "name": tool_name,
                                "args": args,
                                "raw_arguments": raw_arguments,
                                "result": result,
                                "status": result_status,
                                "normalized_result": AIService._normalize_function_response_payload(
                                    result
                                ),
                            }
                        )

                    if not executed_tools:
                        yield AIService._sse_chunk(
                            "error",
                            "模型返回了无法执行的工具调用",
                        )
                        return

                    followup_messages = adapter.build_tool_followup_messages(
                        request,
                        round_state,
                        valid_tool_calls,
                        executed_tools,
                    )
                    if not followup_messages:
                        break

                    messages_with_tools.extend(followup_messages)
                    tool_calls_buffer.clear()
                    round_state = AIService._build_round_state()
                    body = adapter.build_next_body(body, messages_with_tools)

                    async with client.stream(
                        method="POST",
                        url=api_url,
                        headers=headers,
                        json=body,
                    ) as response_next:
                        if response_next.status_code >= 400:
                            error_text = await AIService._format_http_error(
                                response_next,
                                "工具调用失败",
                            )
                            yield AIService._sse_chunk("error", error_text)
                            return

                        async for event in AIService._stream_round(
                            response_next,
                            adapter,
                            request,
                            current_round,
                            tool_calls_buffer,
                            round_state,
                        ):
                            yield event

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
        try:
            request = AIService._normalize_request(request)
            if not request.apiKey:
                yield AIService._sse_chunk("error", "缺少 API Key：请先在配置中填写")
                return
            if not request.model:
                yield AIService._sse_chunk("error", "缺少模型 ID：请先在配置中填写")
                return

            adapter = get_provider_adapter(request.provider)
            if not adapter.supports_responses():
                yield AIService._sse_chunk(
                    "error",
                    "Responses 模式当前只支持 OpenAI 兼容协议",
                )
                return

            request, adapter, _, api_url, headers, body = AIService._build_chat_transport(
                request,
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
                    compat_adapter = create_stream_compat_adapter(
                        request, current_round
                    )
                    assistant_output_started = False

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
                                current_body = adapter.build_responses_manual_followup_body(
                                    request,
                                    pending_manual_followup_items,
                                    responses_tools,
                                )
                                pending_manual_followup_items = None
                                continue
                            yield AIService._sse_chunk("error", error_text)
                            return

                        async for parsed in adapter.parse_responses_stream(response):
                            if parsed.get("error"):
                                yield AIService._sse_chunk("error", parsed["error"])
                                return

                            if parsed.get("response_id"):
                                response_id = str(parsed["response_id"]).strip()

                            if isinstance(parsed.get("response_output_items"), list):
                                response_output_items = list(parsed["response_output_items"])

                            thinking_text = str(parsed.get("thinking") or "")
                            if thinking_text.strip():
                                yield AIService._sse_chunk(
                                    "thinking",
                                    thinking_text,
                                    ensure_ascii=False,
                                )

                            if parsed.get("content"):
                                if compat_adapter is None:
                                    assistant_output_started = True
                                    yield AIService._sse_chunk(
                                        "content",
                                        parsed["content"],
                                        ensure_ascii=False,
                                    )
                                else:
                                    compat_output = compat_adapter.process_content(
                                        parsed["content"]
                                    )
                                    if not assistant_output_started:
                                        for thinking_chunk in compat_output["thinking"]:
                                            if not str(thinking_chunk or "").strip():
                                                continue
                                            yield AIService._sse_chunk(
                                                "thinking",
                                                thinking_chunk,
                                                ensure_ascii=False,
                                            )
                                    for web_search_event in compat_output["web_search"]:
                                        yield AIService._sse_chunk(
                                            "web_search",
                                            web_search_event,
                                            ensure_ascii=False,
                                        )
                                    for content_chunk in compat_output["content"]:
                                        assistant_output_started = True
                                        yield AIService._sse_chunk(
                                            "content",
                                            content_chunk,
                                            ensure_ascii=False,
                                        )

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

                    if compat_adapter is not None:
                        compat_flush = compat_adapter.flush()
                        if not assistant_output_started:
                            for thinking_chunk in compat_flush["thinking"]:
                                if not str(thinking_chunk or "").strip():
                                    continue
                                yield AIService._sse_chunk(
                                    "thinking",
                                    thinking_chunk,
                                    ensure_ascii=False,
                                )
                        for web_search_event in compat_flush["web_search"]:
                            yield AIService._sse_chunk(
                                "web_search",
                                web_search_event,
                                ensure_ascii=False,
                            )
                        for content_chunk in compat_flush["content"]:
                            assistant_output_started = True
                            yield AIService._sse_chunk(
                                "content",
                                content_chunk,
                                ensure_ascii=False,
                            )

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

                        args, _ = AIService._normalize_tool_arguments(
                            tool_name,
                            str(function_call.get("arguments") or ""),
                            request,
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
                        current_body = adapter.build_responses_manual_followup_body(
                            request,
                            pending_manual_followup_items,
                            responses_tools,
                        )
                        accumulated_input_items = AIService._clone_responses_input_items(
                            pending_manual_followup_items
                        )
                        continue

                    pending_manual_followup_items = (
                        AIService._build_responses_manual_followup_items(
                            accumulated_input_items,
                            response_output_items,
                            tool_outputs,
                        )
                    )
                    current_body = adapter.build_responses_followup_body(
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
