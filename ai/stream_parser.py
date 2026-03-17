import json
from typing import Any, AsyncIterator

import httpx


class StreamParser:
    """流式响应解析器"""

    @staticmethod
    def parse_anthropic_chunk(
        chunk: dict,
        content_blocks_state: dict[int, dict[str, Any]] | None = None,
        tool_use_state: dict[int, dict[str, str]] | None = None,
    ) -> dict:
        """解析Anthropic流式响应块"""
        result = {
            "thinking": "",
            "content": "",
            "tokens": None,
            "tool_calls": None,
            "completed_block": None,
        }

        chunk_type = chunk.get("type")

        if chunk_type == "content_block_start":
            index = int(chunk.get("index") or 0)
            content_block = chunk.get("content_block", {})
            if (
                content_blocks_state is not None
                and isinstance(content_block, dict)
                and content_block
            ):
                block_copy = dict(content_block)
                if block_copy.get("type") == "tool_use":
                    input_value = block_copy.get("input")
                    if not isinstance(input_value, dict):
                        input_value = {}
                    block_copy["input"] = input_value
                    block_copy["_input_json_buffer"] = ""
                content_blocks_state[index] = block_copy

            if isinstance(content_block, dict) and content_block.get("type") == "tool_use":
                tool_call = {
                    "index": index,
                    "id": str(content_block.get("id") or ""),
                    "function": {
                        "name": str(content_block.get("name") or ""),
                    },
                }

                input_value = content_block.get("input")
                if isinstance(input_value, dict) and input_value:
                    arguments = json.dumps(input_value, ensure_ascii=False)
                    tool_call["function"]["arguments"] = arguments
                    if tool_use_state is not None:
                        tool_use_state[index] = {
                            "id": tool_call["id"],
                            "name": tool_call["function"]["name"],
                            "arguments": arguments,
                        }
                elif tool_use_state is not None:
                    tool_use_state[index] = {
                        "id": tool_call["id"],
                        "name": tool_call["function"]["name"],
                        "arguments": "",
                    }

                result["tool_calls"] = [tool_call]

        elif chunk_type == "content_block_delta":
            index = int(chunk.get("index") or 0)
            delta = chunk.get("delta", {})
            delta_type = delta.get("type")

            if delta_type == "thinking_delta":
                result["thinking"] = delta.get("thinking", "")
                if (
                    content_blocks_state is not None
                    and index in content_blocks_state
                    and content_blocks_state[index].get("type") == "thinking"
                ):
                    content_blocks_state[index]["thinking"] = (
                        str(content_blocks_state[index].get("thinking") or "")
                        + result["thinking"]
                    )
            elif delta_type == "signature_delta":
                if (
                    content_blocks_state is not None
                    and index in content_blocks_state
                    and content_blocks_state[index].get("type") == "thinking"
                ):
                    content_blocks_state[index]["signature"] = str(
                        delta.get("signature") or ""
                    )
            elif delta_type == "text_delta":
                result["content"] = delta.get("text", "")
                if (
                    content_blocks_state is not None
                    and index in content_blocks_state
                    and content_blocks_state[index].get("type") == "text"
                ):
                    content_blocks_state[index]["text"] = (
                        str(content_blocks_state[index].get("text") or "")
                        + result["content"]
                    )
            elif delta_type == "input_json_delta":
                partial_json = str(delta.get("partial_json") or "")
                if partial_json:
                    if (
                        content_blocks_state is not None
                        and index in content_blocks_state
                        and content_blocks_state[index].get("type") == "tool_use"
                    ):
                        content_blocks_state[index]["_input_json_buffer"] = (
                            str(
                                content_blocks_state[index].get(
                                    "_input_json_buffer"
                                )
                                or ""
                            )
                            + partial_json
                        )

                    tool_id = ""
                    if tool_use_state is not None:
                        tool_state = tool_use_state.setdefault(
                            index, {"id": "", "name": "", "arguments": ""}
                        )
                        tool_state["arguments"] += partial_json
                        tool_id = tool_state.get("id", "")

                    result["tool_calls"] = [
                        {
                            "index": index,
                            "id": tool_id,
                            "function": {
                                "arguments": partial_json,
                            },
                        }
                    ]
        elif chunk_type == "content_block_stop":
            index = int(chunk.get("index") or 0)
            if content_blocks_state is not None:
                completed_block = content_blocks_state.pop(index, None)
                if isinstance(completed_block, dict):
                    if completed_block.get("type") == "tool_use":
                        input_json = str(
                            completed_block.pop("_input_json_buffer", "") or ""
                        )
                        if input_json:
                            try:
                                parsed_input = json.loads(input_json)
                            except Exception:
                                parsed_input = completed_block.get("input") or {}
                            if isinstance(parsed_input, dict):
                                completed_block["input"] = parsed_input
                    result["completed_block"] = completed_block
        elif chunk_type == "message_delta":
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
                usage.get("completion_tokens")
                or usage.get("output_tokens")
                or usage.get("total_tokens")
                or 0
            )

        return result

    @staticmethod
    def parse_gemini_chunk(chunk: dict) -> dict:
        """解析 Gemini 流式响应块"""
        result = {
            "thinking": "",
            "content": "",
            "tokens": None,
            "tool_calls": None,
            "grounding_metadata": None,
            "code_execution": None,
            "model_parts": [],
        }

        candidates = chunk.get("candidates")
        if isinstance(candidates, list) and candidates:
            candidate = candidates[0] if isinstance(candidates[0], dict) else {}
            content = candidate.get("content")
            if isinstance(content, dict):
                parts = content.get("parts")
                if isinstance(parts, list):
                    result["model_parts"] = [
                        part for part in parts if isinstance(part, dict)
                    ]

                    tool_calls = []
                    code_events = []
                    for index, part in enumerate(result["model_parts"]):
                        text = str(part.get("text") or "")
                        if text:
                            if part.get("thought") is True:
                                result["thinking"] += text
                            else:
                                result["content"] += text

                        function_call = part.get("functionCall")
                        if isinstance(function_call, dict):
                            arguments = function_call.get("args")
                            if arguments is None:
                                arguments = {}
                            tool_call = {
                                "index": index,
                                "id": str(function_call.get("id") or ""),
                                "function": {
                                    "name": str(function_call.get("name") or ""),
                                    "arguments": json.dumps(
                                        arguments, ensure_ascii=False
                                    ),
                                },
                            }
                            signature = part.get("thoughtSignature")
                            if signature:
                                tool_call["thought_signature"] = signature
                            tool_calls.append(tool_call)

                        executable_code = part.get("executableCode")
                        if isinstance(executable_code, dict):
                            code_events.append(
                                {
                                    "kind": "code",
                                    "language": str(
                                        executable_code.get("language") or ""
                                    ),
                                    "code": str(executable_code.get("code") or ""),
                                }
                            )

                        execution_result = part.get("codeExecutionResult")
                        if isinstance(execution_result, dict):
                            code_events.append(
                                {
                                    "kind": "result",
                                    "outcome": str(
                                        execution_result.get("outcome") or ""
                                    ),
                                    "output": str(
                                        execution_result.get("output") or ""
                                    ),
                                }
                            )

                    if tool_calls:
                        result["tool_calls"] = tool_calls
                    if code_events:
                        result["code_execution"] = code_events

            grounding_metadata = candidate.get("groundingMetadata")
            if isinstance(grounding_metadata, dict):
                result["grounding_metadata"] = grounding_metadata

        usage = chunk.get("usageMetadata")
        if isinstance(usage, dict):
            result["tokens"] = (
                usage.get("totalTokenCount")
                or usage.get("candidatesTokenCount")
                or usage.get("thoughtsTokenCount")
                or 0
            )

        return result


class ToolCallsAccumulator:
    """累积流式 tool_calls 片段，合并为完整调用信息。"""

    def __init__(self) -> None:
        self._buffer: dict[int, dict[str, str]] = {}

    def __bool__(self) -> bool:
        return bool(self._buffer)

    def clear(self) -> None:
        self._buffer = {}

    def add(self, tool_calls: list[dict]) -> None:
        for tool_call in tool_calls:
            idx = tool_call.get("index", 0)
            if idx not in self._buffer:
                self._buffer[idx] = {
                    "id": "",
                    "name": "",
                    "arguments": "",
                    "thought_signature": "",
                }

            if "id" in tool_call:
                self._buffer[idx]["id"] = tool_call["id"]
            if "thought_signature" in tool_call and tool_call["thought_signature"]:
                self._buffer[idx]["thought_signature"] = tool_call["thought_signature"]

            if "function" in tool_call:
                func = tool_call["function"]
                if "name" in func and func["name"] is not None:
                    incoming_name = str(func["name"])
                    if self._buffer[idx]["name"] == incoming_name:
                        pass
                    elif self._buffer[idx]["name"]:
                        self._buffer[idx]["name"] += func["name"]
                    else:
                        self._buffer[idx]["name"] = func["name"]
                if "arguments" in func and func["arguments"] is not None:
                    incoming_arguments = str(func["arguments"])
                    if self._buffer[idx]["arguments"] == incoming_arguments:
                        pass
                    elif self._buffer[idx]["arguments"]:
                        self._buffer[idx]["arguments"] += func["arguments"]
                    else:
                        self._buffer[idx]["arguments"] = func["arguments"]

    def valid_calls(self) -> dict[int, dict[str, str]]:
        return {
            idx: tc
            for idx, tc in self._buffer.items()
            if tc.get("name", "").strip()
        }


async def parse_sse_stream(response: httpx.Response, provider_mode: str) -> AsyncIterator[dict]:
    """统一 SSE 流解析：字节流 -> data 行 -> JSON -> 标准化 parsed 块。"""
    buffer = ""
    anthropic_content_blocks: dict[int, dict[str, Any]] = {}
    anthropic_tool_use_state: dict[int, dict[str, str]] = {}

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
            except json.JSONDecodeError:
                continue

            if provider_mode == "anthropic":
                yield StreamParser.parse_anthropic_chunk(
                    chunk_json,
                    anthropic_content_blocks,
                    anthropic_tool_use_state,
                )
            elif provider_mode == "gemini":
                yield StreamParser.parse_gemini_chunk(chunk_json)
            else:
                yield StreamParser.parse_openai_chunk(chunk_json)


def summarize_tool_result(result: str) -> tuple[str, str, dict[str, Any] | None]:
    """生成工具执行摘要，返回 (status, summary, parsed_result_dict)。"""
    result_status = "success"
    result_summary = "调用完成"
    parsed_result_dict: dict[str, Any] | None = None

    try:
        parsed_result = json.loads(result)
        if isinstance(parsed_result, dict):
            parsed_result_dict = parsed_result
            if parsed_result.get("error"):
                result_status = "error"
                result_summary = str(parsed_result.get("error") or "工具返回错误")
            elif isinstance(parsed_result.get("results"), list):
                count = len(parsed_result.get("results", []))
                first_title = ""
                if count > 0:
                    first_item = parsed_result.get("results", [])[0]
                    if isinstance(first_item, dict):
                        first_title = str(first_item.get("title") or "").strip()

                if first_title:
                    if len(first_title) > 36:
                        first_title = first_title[:36].rstrip() + "..."
                    result_summary = f"返回 {count} 条结果，首条：{first_title}"
                else:
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

    return result_status, result_summary, parsed_result_dict


def extract_sources_from_search_result(search_result: dict[str, Any]) -> list[dict[str, str]]:
    source_items = search_result.get("results")
    if not isinstance(source_items, list) or not source_items:
        return []
    return [
        {
            "title": (s.get("title") or "").strip(),
            "url": (s.get("url") or "").strip(),
        }
        for s in source_items
        if isinstance(s, dict) and (s.get("url") or "").strip()
    ]


def build_web_search_event(
    search_result: dict[str, Any],
    args: dict[str, Any],
    current_round: int,
    tool_name: str,
) -> dict[str, Any] | None:
    source_items = search_result.get("results")
    if not isinstance(source_items, list) or not source_items:
        return None

    preview_results = []
    for s in source_items[:8]:
        if not isinstance(s, dict):
            continue

        title = str(s.get("title") or "").strip()
        source_url = str(s.get("url") or "").strip()
        content = str(
            s.get("content")
            or s.get("snippet")
            or s.get("summary")
            or s.get("text")
            or ""
        ).strip()
        content = " ".join(content.split())
        if len(content) > 300:
            content = content[:300].rstrip() + "..."

        if title or source_url or content:
            preview_results.append(
                {
                    "title": title,
                    "url": source_url,
                    "content": content,
                }
            )

    if not preview_results:
        return None

    return {
        "status": "ready",
        "round": current_round,
        "name": tool_name,
        "query": str((search_result.get("query") or args.get("query") or "")).strip(),
        "answer": str(search_result.get("answer") or "").strip(),
        "totalResults": len(source_items),
        "results": preview_results,
    }


def extract_sources_from_grounding_metadata(
    grounding_metadata: dict[str, Any],
) -> list[dict[str, str]]:
    chunks = grounding_metadata.get("groundingChunks")
    if not isinstance(chunks, list):
        return []

    sources = []
    seen_urls = set()
    for item in chunks:
        if not isinstance(item, dict):
            continue
        web = item.get("web")
        if not isinstance(web, dict):
            continue
        url = str(web.get("uri") or "").strip()
        title = str(web.get("title") or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        sources.append({"title": title, "url": url})

    return sources


def build_web_search_event_from_grounding(
    grounding_metadata: dict[str, Any], current_round: int
) -> dict[str, Any] | None:
    queries = grounding_metadata.get("webSearchQueries")
    query = ""
    if isinstance(queries, list):
        query = " | ".join(str(item).strip() for item in queries if str(item).strip())

    sources = extract_sources_from_grounding_metadata(grounding_metadata)
    if not query and not sources:
        return None

    preview_results = []
    for source in sources[:8]:
        preview_results.append(
            {
                "title": str(source.get("title") or "").strip(),
                "url": str(source.get("url") or "").strip(),
                "content": "",
            }
        )

    return {
        "status": "ready",
        "round": current_round,
        "name": "google_search",
        "query": query,
        "answer": "",
        "totalResults": len(sources),
        "results": preview_results,
    }
