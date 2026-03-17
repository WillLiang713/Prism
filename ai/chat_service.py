import json
from typing import Any, AsyncIterator

import httpx

from .models import ChatRequest
from .providers import MessageBuilder, ProviderConfig
from .stream_parser import (
    ToolCallsAccumulator,
    build_web_search_event,
    build_web_search_event_from_grounding,
    extract_sources_from_grounding_metadata,
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
    def _custom_tool_calls_enabled(request: ChatRequest, provider_mode: str) -> bool:
        if not request.enableTools:
            return False
        if provider_mode != "gemini":
            return True
        return not (request.enableGoogleSearch or request.enableCodeExecution)

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
        tool_name: str, raw_arguments: str, request: ChatRequest
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
        existing_parts: list[dict[str, Any]], new_parts: list[dict[str, Any]]
    ) -> None:
        for part in new_parts:
            if isinstance(part, dict):
                existing_parts.append(dict(part))

    @staticmethod
    def _build_code_execution_event(
        buffer: dict[str, Any],
    ) -> dict[str, Any] | None:
        if not isinstance(buffer, dict):
            return None
        language = str(buffer.get("language") or "").strip()
        code = str(buffer.get("code") or "")
        output = str(buffer.get("output") or "")
        outcome = str(buffer.get("outcome") or "").strip()
        if not code and not output and not outcome:
            return None
        return {
            "language": language,
            "code": code,
            "output": output,
            "outcome": outcome,
        }

    @staticmethod
    def _consume_code_execution_events(
        state: dict[str, Any], code_events: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        emitted = []
        for item in code_events:
            if not isinstance(item, dict):
                continue
            pending = state.setdefault("pending_code_execution", {})
            if item.get("kind") == "code":
                existing = AIService._build_code_execution_event(pending)
                if existing:
                    emitted.append(existing)
                state["pending_code_execution"] = {
                    "language": str(item.get("language") or "").strip(),
                    "code": str(item.get("code") or ""),
                    "output": "",
                    "outcome": "",
                }
            elif item.get("kind") == "result":
                pending["output"] = str(item.get("output") or "")
                pending["outcome"] = str(item.get("outcome") or "").strip()
                complete = AIService._build_code_execution_event(pending)
                if complete:
                    emitted.append(complete)
                state["pending_code_execution"] = {}

        return emitted

    @staticmethod
    def _flush_pending_code_execution(state: dict[str, Any]) -> list[dict[str, Any]]:
        pending = state.get("pending_code_execution") or {}
        state["pending_code_execution"] = {}
        event = AIService._build_code_execution_event(pending)
        return [event] if event else []

    @staticmethod
    def _code_execution_key(event: dict[str, Any]) -> tuple[str, str, str, str]:
        return (
            str(event.get("language") or ""),
            str(event.get("code") or ""),
            str(event.get("output") or ""),
            str(event.get("outcome") or ""),
        )

    @staticmethod
    def _build_round_state() -> dict[str, Any]:
        return {
            "assistant_thinking": "",
            "assistant_content": "",
            "assistant_blocks": [],
            "gemini_model_parts": [],
            "grounding_urls": set(),
            "web_search_keys": set(),
            "pending_code_execution": {},
            "code_execution_keys": set(),
        }

    @staticmethod
    def _build_messages_buffer(body: dict[str, Any], provider_mode: str) -> list[dict[str, Any]]:
        if provider_mode == "gemini":
            return list(body.get("contents") or [])
        return list(body.get("messages") or [])

    @staticmethod
    def _build_next_body(
        body: dict[str, Any],
        provider_mode: str,
        messages_with_tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        next_body = dict(body)
        if provider_mode == "gemini":
            next_body["contents"] = messages_with_tools
        else:
            next_body["messages"] = messages_with_tools
        return next_body

    @staticmethod
    def _build_gemini_assistant_message(
        round_state: dict[str, Any], valid_tool_calls: dict[int, dict[str, str]]
    ) -> dict[str, Any]:
        parts = list(round_state.get("gemini_model_parts") or [])
        if not parts and round_state.get("assistant_content"):
            parts.append({"text": round_state["assistant_content"]})

        has_function_call = any(
            isinstance(part, dict) and isinstance(part.get("functionCall"), dict)
            for part in parts
        )
        if not has_function_call:
            for _, tool_call in sorted(valid_tool_calls.items()):
                try:
                    args = json.loads(tool_call.get("arguments") or "{}")
                except Exception:
                    args = {}
                if not isinstance(args, dict):
                    args = {}
                part = {
                    "functionCall": {
                        "name": tool_call.get("name") or "",
                        "args": args,
                    }
                }
                thought_signature = str(tool_call.get("thought_signature") or "")
                if thought_signature:
                    part["thoughtSignature"] = thought_signature
                parts.append(part)

        return {"role": "model", "parts": parts}

    @staticmethod
    def _extract_error_text(response_text: bytes) -> str:
        return response_text.decode(errors="ignore")

    @staticmethod
    async def _stream_round(
        response: httpx.Response,
        provider_mode: str,
        request: ChatRequest,
        current_round: int,
        tool_calls_buffer: ToolCallsAccumulator,
        round_state: dict[str, Any],
    ) -> AsyncIterator[str]:
        custom_tool_calls_enabled = AIService._custom_tool_calls_enabled(
            request, provider_mode
        )

        async for parsed in parse_sse_stream(response, provider_mode):
            if provider_mode == "anthropic" and parsed.get("completed_block"):
                round_state["assistant_blocks"].append(parsed["completed_block"])

            if provider_mode == "gemini" and parsed.get("model_parts"):
                AIService._append_gemini_model_parts(
                    round_state["gemini_model_parts"], parsed["model_parts"]
                )

            if parsed.get("thinking"):
                round_state["assistant_thinking"] += parsed["thinking"]
                yield (
                    f"data: {json.dumps({'type': 'thinking', 'data': parsed['thinking']})}\n\n"
                )

            if parsed.get("content"):
                round_state["assistant_content"] += parsed["content"]
                yield (
                    f"data: {json.dumps({'type': 'content', 'data': parsed['content']})}\n\n"
                )

            if parsed.get("tool_calls") and custom_tool_calls_enabled:
                tool_calls_buffer.add(parsed["tool_calls"])

            if parsed.get("tokens") is not None:
                yield (
                    f"data: {json.dumps({'type': 'tokens', 'data': parsed['tokens']})}\n\n"
                )

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
                        yield (
                            "data: "
                            + json.dumps(
                                {"type": "sources", "data": fresh_sources},
                                ensure_ascii=False,
                            )
                            + "\n\n"
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
                            yield (
                                "data: "
                                + json.dumps(
                                    {
                                        "type": "web_search",
                                        "data": web_search_event,
                                    },
                                    ensure_ascii=False,
                                )
                                + "\n\n"
                            )

                code_events = parsed.get("code_execution")
                if isinstance(code_events, list):
                    for event in AIService._consume_code_execution_events(
                        round_state, code_events
                    ):
                        event_key = AIService._code_execution_key(event)
                        if event_key in round_state["code_execution_keys"]:
                            continue
                        round_state["code_execution_keys"].add(event_key)
                        yield (
                            "data: "
                            + json.dumps(
                                {"type": "code_execution", "data": event},
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )

        if provider_mode == "gemini":
            for event in AIService._flush_pending_code_execution(round_state):
                event_key = AIService._code_execution_key(event)
                if event_key in round_state["code_execution_keys"]:
                    continue
                round_state["code_execution_keys"].add(event_key)
                yield (
                    "data: "
                    + json.dumps(
                        {"type": "code_execution", "data": event},
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )

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
            provider_mode = ProviderConfig.get_provider_mode(request.provider)
            api_url = ProviderConfig.get_api_url(
                request.provider,
                request.apiUrl,
                provider_mode,
                request.model,
                stream=True,
            )
            headers = ProviderConfig.build_headers(request.apiKey, provider_mode)

            history_messages = []
            if request.historyTurns:
                history_messages = MessageBuilder.convert_history_to_messages(
                    request.historyTurns, "main", provider_mode
                )

            current_user_content = MessageBuilder._build_user_content(
                request.prompt, request.images, provider_mode
            )
            body = MessageBuilder.build_request_body(
                request, provider_mode, current_user_content, history_messages
            )

            async with httpx.AsyncClient(timeout=60.0) as client:
                tool_calls_buffer = ToolCallsAccumulator()
                round_state = AIService._build_round_state()

                async with client.stream(
                    method="POST", url=api_url, headers=headers, json=body
                ) as response:
                    if response.status_code >= 400:
                        error_text = AIService._extract_error_text(await response.aread())
                        yield (
                            f"data: {json.dumps({'type': 'error', 'data': f'HTTP {response.status_code}: {error_text}'})}\n\n"
                        )
                        return

                    async for event in AIService._stream_round(
                        response,
                        provider_mode,
                        request,
                        0,
                        tool_calls_buffer,
                        round_state,
                    ):
                        yield event

                current_round = 0
                max_rounds = min(request.maxToolRounds, 200)
                messages_with_tools = AIService._build_messages_buffer(body, provider_mode)

                while (
                    tool_calls_buffer
                    and AIService._custom_tool_calls_enabled(request, provider_mode)
                    and current_round < max_rounds
                ):
                    current_round += 1
                    valid_tool_calls = tool_calls_buffer.valid_calls()
                    if not valid_tool_calls:
                        break

                    tool_runtime_context = AIService._build_tool_runtime_context(request)
                    tool_results = []
                    gemini_tool_results_parts = []

                    if provider_mode == "anthropic":
                        assistant_message: dict[str, Any] | None = {
                            "role": "assistant",
                            "content": list(round_state["assistant_blocks"]),
                        }
                        use_synthetic_anthropic_blocks = (
                            len(assistant_message["content"]) == 0
                        )
                        anthropic_tool_results: list[dict[str, Any]] = []
                    elif provider_mode == "gemini":
                        assistant_message = AIService._build_gemini_assistant_message(
                            round_state, valid_tool_calls
                        )
                        use_synthetic_anthropic_blocks = False
                        anthropic_tool_results = []
                    else:
                        assistant_message = {
                            "role": "assistant",
                            "tool_calls": [],
                        }
                        use_synthetic_anthropic_blocks = False
                        anthropic_tool_results = []

                        if round_state["assistant_content"]:
                            assistant_message["content"] = round_state["assistant_content"]
                        if round_state["assistant_thinking"]:
                            model_lower = request.model.lower()
                            if "deepseek" in model_lower or "o1" in model_lower:
                                assistant_message["reasoning_content"] = round_state[
                                    "assistant_thinking"
                                ]

                    for idx, tool_call in sorted(valid_tool_calls.items()):
                        tool_name = tool_call["name"]
                        args, _ = AIService._normalize_tool_arguments(
                            tool_name, tool_call.get("arguments") or "", request
                        )

                        yield (
                            "data: "
                            + json.dumps(
                                {
                                    "type": "tool",
                                    "data": {
                                        "status": "start",
                                        "round": current_round,
                                        "name": tool_name,
                                        "arguments": args,
                                    },
                                }
                            )
                            + "\n\n"
                        )

                        result = await AIService.execute_tool(
                            tool_name,
                            args,
                            tool_runtime_context,
                        )

                        (
                            result_status,
                            result_summary,
                            parsed_result_dict,
                        ) = summarize_tool_result(result)
                        yield (
                            "data: "
                            + json.dumps(
                                {
                                    "type": "tool",
                                    "data": {
                                        "status": result_status,
                                        "round": current_round,
                                        "name": tool_name,
                                        "resultSummary": result_summary,
                                    },
                                }
                            )
                            + "\n\n"
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
                                    sources = extract_sources_from_search_result(
                                        search_result
                                    )
                                    if sources:
                                        yield (
                                            "data: "
                                            + json.dumps(
                                                {"type": "sources", "data": sources},
                                                ensure_ascii=False,
                                            )
                                            + "\n\n"
                                        )

                                    web_search_event = build_web_search_event(
                                        search_result, args, current_round, tool_name
                                    )
                                    if web_search_event:
                                        yield (
                                            "data: "
                                            + json.dumps(
                                                {
                                                    "type": "web_search",
                                                    "data": web_search_event,
                                                },
                                                ensure_ascii=False,
                                            )
                                            + "\n\n"
                                        )
                            except Exception:
                                pass

                        tool_call_id = tool_call["id"] or f"call_{idx}"
                        if provider_mode == "anthropic":
                            if use_synthetic_anthropic_blocks:
                                assistant_content_blocks = assistant_message.get(
                                    "content", []
                                )
                                if (
                                    not assistant_content_blocks
                                    and round_state["assistant_content"]
                                ):
                                    assistant_content_blocks.append(
                                        {
                                            "type": "text",
                                            "text": round_state["assistant_content"],
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
                        elif provider_mode == "gemini":
                            gemini_tool_results_parts.append(
                                {
                                    "functionResponse": {
                                        "name": tool_name,
                                        "response": AIService._normalize_function_response_payload(
                                            result
                                        ),
                                    }
                                }
                            )
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
                            tool_results.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tool_call_id,
                                    "content": result,
                                }
                            )

                    if provider_mode == "anthropic":
                        assistant_content_blocks = (
                            assistant_message.get("content", [])
                            if isinstance(assistant_message, dict)
                            else []
                        )
                        if not assistant_content_blocks and round_state["assistant_content"]:
                            assistant_content_blocks.append(
                                {
                                    "type": "text",
                                    "text": round_state["assistant_content"],
                                }
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
                    elif provider_mode == "gemini":
                        if assistant_message.get("parts"):
                            messages_with_tools.append(assistant_message)
                        if gemini_tool_results_parts:
                            messages_with_tools.append(
                                {
                                    "role": "user",
                                    "parts": gemini_tool_results_parts,
                                }
                            )
                    else:
                        messages_with_tools.append(assistant_message)
                        messages_with_tools.extend(tool_results)

                    tool_calls_buffer.clear()
                    round_state = AIService._build_round_state()
                    body_next = AIService._build_next_body(
                        body, provider_mode, messages_with_tools
                    )

                    async with client.stream(
                        method="POST",
                        url=api_url,
                        headers=headers,
                        json=body_next,
                    ) as response_next:
                        if response_next.status_code >= 400:
                            error_text = AIService._extract_error_text(
                                await response_next.aread()
                            )
                            yield (
                                f"data: {json.dumps({'type': 'error', 'data': f'工具调用失败 HTTP {response_next.status_code}: {error_text}'})}\n\n"
                            )
                            return

                        async for event in AIService._stream_round(
                            response_next,
                            provider_mode,
                            request,
                            current_round,
                            tool_calls_buffer,
                            round_state,
                        ):
                            yield event

                    if current_round >= max_rounds and tool_calls_buffer:
                        yield (
                            f"data: {json.dumps({'type': 'error', 'data': f'已达到最大工具调用轮数限制 ({max_rounds}轮)，停止继续调用工具'})}\n\n"
                        )
                        break

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"
