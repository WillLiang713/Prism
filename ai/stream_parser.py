import json
from typing import Any, AsyncIterator

import httpx


def _extract_image_url_from_item(item: Any) -> str:
    if isinstance(item, str):
        return item.strip()
    if not isinstance(item, dict):
        return ""

    item_type = str(item.get("type") or "").strip().lower()
    if item_type == "image_url":
        image_value = item.get("image_url")
        if isinstance(image_value, dict):
            return str(image_value.get("url") or "").strip()
        return str(image_value or "").strip()

    if "url" in item:
        return str(item.get("url") or "").strip()

    image_value = item.get("image")
    if isinstance(image_value, dict):
        return str(image_value.get("url") or "").strip()
    return ""


def _append_openai_images(target: list[dict[str, str]], payload: Any) -> None:
    if not isinstance(payload, list):
        return

    seen_urls = {str(item.get("url") or "").strip() for item in target}
    for item in payload:
        image_url = _extract_image_url_from_item(item)
        if not image_url or image_url in seen_urls:
            continue
        seen_urls.add(image_url)
        target.append({"url": image_url})


def _build_data_url(mime_type: str, data: str) -> str:
    normalized_mime_type = str(mime_type or "").strip() or "image/png"
    return f"data:{normalized_mime_type};base64,{data}"


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
            "tool": None,
            "web_search": None,
            "sources": None,
            "stop_reason": "",
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
                if block_copy.get("type") in {"tool_use", "server_tool_use"}:
                    input_value = block_copy.get("input")
                    if not isinstance(input_value, dict):
                        input_value = {}
                    block_copy["input"] = input_value
                    block_copy["_input_json_buffer"] = ""
                if block_copy.get("type") == "text":
                    citations = block_copy.get("citations")
                    block_copy["citations"] = citations if isinstance(citations, list) else []
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
            elif (
                isinstance(content_block, dict)
                and content_block.get("type") == "server_tool_use"
            ):
                tool_id = str(content_block.get("id") or "")
                tool_name = str(content_block.get("name") or "web_search").strip() or "web_search"
                query = _extract_anthropic_server_tool_query(content_block)
                result["tool"] = {
                    "callId": tool_id,
                    "status": "start",
                    "name": tool_name,
                }
                if query:
                    result["tool"]["arguments"] = {"query": query}
                result["web_search"] = {
                    "callId": tool_id,
                    "status": "loading",
                    "name": tool_name,
                    "query": query,
                    "answer": "",
                    "results": [],
                    "totalResults": 0,
                }

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
            elif delta_type == "citations_delta":
                citation = delta.get("citation")
                if (
                    isinstance(citation, dict)
                    and content_blocks_state is not None
                    and index in content_blocks_state
                    and content_blocks_state[index].get("type") == "text"
                ):
                    citations = content_blocks_state[index].setdefault("citations", [])
                    if isinstance(citations, list):
                        citations.append(citation)
            elif delta_type == "input_json_delta":
                partial_json = str(delta.get("partial_json") or "")
                if partial_json:
                    if (
                        content_blocks_state is not None
                        and index in content_blocks_state
                        and content_blocks_state[index].get("type")
                        in {"tool_use", "server_tool_use"}
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
                    if (
                        tool_use_state is not None
                        and content_blocks_state is not None
                        and index in content_blocks_state
                        and content_blocks_state[index].get("type") == "tool_use"
                    ):
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
                    if completed_block.get("type") in {"tool_use", "server_tool_use"}:
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
            delta = chunk.get("delta", {})
            if isinstance(delta, dict):
                result["stop_reason"] = str(delta.get("stop_reason") or "")

        return result

    @staticmethod
    def parse_openai_chunk(chunk: dict) -> dict:
        """解析OpenAI流式响应块"""
        result = {
            "thinking": "",
            "content": "",
            "tokens": None,
            "tool_calls": None,
            "images": None,
        }

        choices = chunk.get("choices", [])
        if choices and len(choices) > 0:
            choice = choices[0] if isinstance(choices[0], dict) else {}
            delta = choice.get("delta", {})
            message = choice.get("message", {})

            # 思考内容
            if "reasoning_content" in delta:
                result["thinking"] = delta["reasoning_content"]

            # 正常内容
            if "content" in delta:
                result["content"] = delta["content"]

            # 工具调用
            if "tool_calls" in delta and delta["tool_calls"]:
                result["tool_calls"] = delta["tool_calls"]

            images: list[dict[str, str]] = []
            _append_openai_images(images, delta.get("images"))
            _append_openai_images(images, message.get("images"))
            if images:
                result["images"] = images

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
            "model_parts": [],
            "images": None,
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
                    images: list[dict[str, str]] = []
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

                        inline_data = part.get("inlineData")
                        if not isinstance(inline_data, dict):
                            inline_data = part.get("inline_data")
                        if isinstance(inline_data, dict):
                            data = str(inline_data.get("data") or "").strip()
                            if data:
                                mime_type = str(
                                    inline_data.get("mimeType")
                                    or inline_data.get("mime_type")
                                    or "image/png"
                                ).strip() or "image/png"
                                images.append(
                                    {"url": _build_data_url(mime_type, data)}
                                )

                    if tool_calls:
                        result["tool_calls"] = tool_calls
                    if images:
                        result["images"] = images

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


def _extract_anthropic_server_tool_query(block: dict[str, Any] | None) -> str:
    if not isinstance(block, dict):
        return ""

    input_payload = block.get("input")
    if isinstance(input_payload, dict):
        query = str(input_payload.get("query") or "").strip()
        if query:
            return query

    return str(block.get("query") or "").strip()


def _extract_source_from_anthropic_item(
    item: dict[str, Any] | None,
) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None

    source_url = str(item.get("url") or item.get("uri") or "").strip()
    if not source_url:
        return None

    return {
        "title": str(item.get("title") or item.get("name") or "").strip(),
        "url": source_url,
    }


def extract_sources_from_anthropic_citations(
    citations: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    if not isinstance(citations, list):
        return []

    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for citation in citations:
        if not isinstance(citation, dict):
            continue

        candidates = [citation]
        for key in ("source", "document", "location", "web_search_result_location"):
            nested = citation.get(key)
            if isinstance(nested, dict):
                candidates.append(nested)

        for candidate in candidates:
            source = _extract_source_from_anthropic_item(candidate)
            if not source:
                continue
            if source["url"] in seen:
                continue
            seen.add(source["url"])
            sources.append(source)

    return sources


def _collect_anthropic_search_results(
    value: Any,
    results: list[dict[str, str]],
    seen: set[str],
) -> None:
    if isinstance(value, list):
        for item in value:
            _collect_anthropic_search_results(item, results, seen)
        return

    if not isinstance(value, dict):
        return

    source = _extract_source_from_anthropic_item(value)
    if source and source["url"] not in seen:
        seen.add(source["url"])
        results.append(source)

    for key, nested in value.items():
        if key in {"encrypted_content", "encrypted_index"}:
            continue
        if isinstance(nested, (dict, list)):
            _collect_anthropic_search_results(nested, results, seen)


def extract_sources_from_anthropic_content_block(
    content_block: dict[str, Any] | None,
) -> list[dict[str, str]]:
    if not isinstance(content_block, dict):
        return []

    block_type = str(content_block.get("type") or "").strip()
    if block_type == "text":
        return extract_sources_from_anthropic_citations(content_block.get("citations"))

    if block_type != "web_search_tool_result":
        return []

    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    _collect_anthropic_search_results(content_block, sources, seen)
    return sources


def build_anthropic_web_search_event(
    content_block: dict[str, Any] | None,
    current_round: int,
) -> dict[str, Any] | None:
    if not isinstance(content_block, dict):
        return None
    if str(content_block.get("type") or "").strip() != "web_search_tool_result":
        return None

    sources = extract_sources_from_anthropic_content_block(content_block)
    preview_results = [
        {
            "title": str(source.get("title") or "").strip(),
            "url": str(source.get("url") or "").strip(),
            "content": "",
        }
        for source in sources[:8]
        if isinstance(source, dict)
        and (str(source.get("title") or "").strip() or str(source.get("url") or "").strip())
    ]

    error_text = str(content_block.get("error") or "").strip()
    return {
        "callId": str(
            content_block.get("tool_use_id") or content_block.get("id") or ""
        ).strip(),
        "status": "error" if error_text else "ready",
        "round": current_round,
        "name": "web_search",
        "query": _extract_anthropic_server_tool_query(content_block),
        "answer": "",
        "error": error_text,
        "totalResults": len(sources),
        "results": preview_results,
    }


def extract_sources_from_annotations(
    annotations: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    """从 Responses 输出标注中提取来源。"""
    if not isinstance(annotations, list):
        return []

    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    for annotation in annotations:
        if not isinstance(annotation, dict):
            continue
        source_url = str(annotation.get("url") or "").strip()
        if source_url in seen:
            continue
        seen.add(source_url)
        sources.append(
            {
                "title": str(annotation.get("title") or "").strip(),
                "url": source_url,
            }
        )
    return sources


def _extract_text_and_annotations_from_response_item(
    item: dict[str, Any] | None,
) -> tuple[str, list[dict[str, Any]]]:
    if not isinstance(item, dict):
        return "", []

    texts: list[str] = []
    annotations: list[dict[str, Any]] = []
    content = item.get("content")
    if not isinstance(content, list):
        return "", []

    for block in content:
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type") or "").strip()
        if block_type not in {"output_text", "text"}:
            continue

        text = str(block.get("text") or "").strip()
        if text:
            texts.append(text)

        block_annotations = block.get("annotations")
        if isinstance(block_annotations, list):
            annotations.extend(
                ann for ann in block_annotations if isinstance(ann, dict)
            )

    return "".join(texts), annotations


def _extract_reasoning_text(item: dict[str, Any] | None) -> str:
    if not isinstance(item, dict):
        return ""
    if str(item.get("type") or "").strip() != "reasoning":
        return ""

    summaries = item.get("summary")
    if not isinstance(summaries, list):
        return ""

    parts: list[str] = []
    for summary in summaries:
        if not isinstance(summary, dict):
            continue
        text = str(summary.get("text") or "").strip()
        if text:
            parts.append(text)
    return "\n".join(parts)


def _extract_web_search_query(item: dict[str, Any]) -> str:
    action = item.get("action")
    if isinstance(action, dict):
        query = str(action.get("query") or "").strip()
        if query:
            return query
        queries = action.get("queries")
        if isinstance(queries, list):
            for value in queries:
                query = str(value or "").strip()
                if query:
                    return query
    return str(item.get("query") or "").strip()


def extract_sources_from_responses_web_search_call(
    item: dict[str, Any] | None,
) -> list[dict[str, str]]:
    if not isinstance(item, dict):
        return []
    if str(item.get("type") or "").strip() != "web_search_call":
        return []

    sources: list[dict[str, str]] = []
    seen: set[str] = set()

    action = item.get("action")
    if isinstance(action, dict):
        action_sources = action.get("sources")
        if isinstance(action_sources, list):
            for source in action_sources:
                if not isinstance(source, dict):
                    continue
                source_url = str(source.get("url") or "").strip()
                if source_url in seen:
                    continue
                seen.add(source_url)
                sources.append(
                    {
                        "title": str(source.get("title") or "").strip(),
                        "url": source_url,
                    }
                )

    for result in item.get("results") or []:
        if not isinstance(result, dict):
            continue
        source_url = str(result.get("url") or "").strip()
        if source_url in seen:
            continue
        seen.add(source_url)
        sources.append(
            {
                "title": str(result.get("title") or "").strip(),
                "url": source_url,
            }
        )

    return sources


def build_responses_web_search_event(
    item: dict[str, Any] | None,
    current_round: int,
) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    if str(item.get("type") or "").strip() != "web_search_call":
        return None

    preview_results = []
    for result in item.get("results") or []:
        if not isinstance(result, dict):
            continue
        title = str(result.get("title") or "").strip()
        source_url = str(result.get("url") or "").strip()
        content = str(
            result.get("text")
            or result.get("snippet")
            or result.get("summary")
            or result.get("content")
            or ""
        ).strip()
        if title or source_url or content:
            preview_results.append(
                {
                    "title": title,
                    "url": source_url,
                    "content": content,
                }
            )

    if not preview_results:
        action = item.get("action")
        if isinstance(action, dict):
            for source in action.get("sources") or []:
                if not isinstance(source, dict):
                    continue
                title = str(source.get("title") or "").strip()
                source_url = str(source.get("url") or "").strip()
                if title or source_url:
                    preview_results.append(
                        {"title": title, "url": source_url, "content": ""}
                    )

    if not preview_results:
        return None

    return {
        "callId": str(item.get("id") or "").strip(),
        "status": "ready",
        "round": current_round,
        "name": "web_search",
        "query": _extract_web_search_query(item),
        "answer": str(item.get("summary") or "").strip(),
        "totalResults": len(preview_results),
        "results": preview_results[:8],
    }


def build_web_search_event_from_sources(
    sources: list[dict[str, str]] | None,
    current_round: int = 0,
) -> dict[str, Any] | None:
    if not isinstance(sources, list):
        return None

    preview_results: list[dict[str, str]] = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        title = str(source.get("title") or "").strip()
        source_url = str(source.get("url") or "").strip()
        if title or source_url:
            preview_results.append(
                {
                    "title": title,
                    "url": source_url,
                    "content": "",
                }
            )

    if not preview_results:
        return None

    return {
        "status": "ready",
        "round": current_round,
        "name": "web_search",
        "query": "",
        "answer": "",
        "totalResults": len(preview_results),
        "results": preview_results[:8],
    }

def parse_responses_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
    """解析 OpenAI Responses API 流式事件。"""
    result: dict[str, Any] = {
        "thinking": "",
        "content": "",
        "tokens": None,
        "tool": None,
        "web_search": None,
        "sources": None,
        "error": None,
        "call_id": "",
        "response_id": "",
        "function_calls": None,
        "response_output_items": None,
    }

    event_type = str(chunk.get("type") or "").strip()
    response_id = str(chunk.get("response_id") or "").strip()
    if response_id:
        result["response_id"] = response_id
    response_payload = chunk.get("response")
    if isinstance(response_payload, dict) and not result["response_id"]:
        result["response_id"] = str(response_payload.get("id") or "")

    if event_type == "response.output_text.delta":
        result["content"] = str(chunk.get("delta") or "")
        return result

    if event_type in {
        "response.reasoning_summary_text.delta",
        "response.reasoning_text.delta",
    }:
        result["thinking"] = str(chunk.get("delta") or "")
        return result

    if event_type == "response.function_call_arguments.done":
        call_id = str(chunk.get("call_id") or "").strip()
        item_id = str(chunk.get("item_id") or chunk.get("id") or "").strip()
        function_name = str(chunk.get("name") or "").strip()
        arguments = str(chunk.get("arguments") or "")
        if call_id:
            result["call_id"] = call_id
        if call_id or item_id:
            result["function_calls"] = [
                {
                    "id": item_id,
                    "call_id": call_id,
                    "name": function_name,
                    "arguments": arguments,
                }
            ]
        return result

    if event_type == "response.output_item.added":
        item = chunk.get("item")
        if isinstance(item, dict) and item.get("type") == "web_search_call":
            result["call_id"] = str(item.get("id") or "")
            query = _extract_web_search_query(item)
            result["tool"] = {
                "callId": result["call_id"],
                "status": "start",
                "name": "web_search",
            }
            if query:
                result["tool"]["arguments"] = {"query": query}
        return result

    if event_type == "response.output_item.done":
        item = chunk.get("item")
        if not isinstance(item, dict):
            return result

        item_type = str(item.get("type") or "").strip()
        if item_type == "message":
            _, annotations = _extract_text_and_annotations_from_response_item(item)
            sources = extract_sources_from_annotations(annotations)
            if sources:
                result["sources"] = sources
            return result

        if item_type == "reasoning":
            result["thinking"] = _extract_reasoning_text(item)
            return result

        if item_type == "web_search_call":
            result["call_id"] = str(item.get("id") or "")
            status = str(item.get("status") or "").strip().lower()
            tool_status = "error" if status in {"failed", "error"} else "success"
            query = _extract_web_search_query(item)
            result["tool"] = {
                "callId": result["call_id"],
                "status": tool_status,
                "name": "web_search",
                "resultSummary": (
                    str(item.get("error") or "").strip()
                    if tool_status == "error"
                    else (
                        f"返回 {len(item.get('results') or [])} 条结果"
                        if isinstance(item.get("results"), list)
                        else "搜索完成"
                    )
                ),
            }
            if query:
                result["tool"]["arguments"] = {"query": query}

            web_search = build_responses_web_search_event(item, 0)
            if web_search:
                result["web_search"] = web_search

            sources = extract_sources_from_responses_web_search_call(item)
            if sources:
                result["sources"] = sources
            return result

        if item_type == "function_call":
            call_id = str(item.get("call_id") or item.get("id") or "").strip()
            result["call_id"] = call_id
            result["function_calls"] = [
                {
                    "id": str(item.get("id") or "").strip(),
                    "call_id": call_id,
                    "name": str(item.get("name") or "").strip(),
                    "arguments": str(item.get("arguments") or ""),
                }
            ]
            return result

        return result

    if event_type == "response.completed":
        response = chunk.get("response")
        if isinstance(response, dict):
            output_items = response.get("output")
            if isinstance(output_items, list):
                result["response_output_items"] = output_items
            collected_sources: list[dict[str, str]] = []
            if isinstance(output_items, list):
                for item in output_items:
                    if not isinstance(item, dict):
                        continue
                    item_type = str(item.get("type") or "").strip()
                    if item_type == "message":
                        _, annotations = _extract_text_and_annotations_from_response_item(item)
                        collected_sources.extend(
                            extract_sources_from_annotations(annotations)
                        )
                    elif item_type == "web_search_call":
                        if result["web_search"] is None:
                            web_search = build_responses_web_search_event(item, 0)
                            if web_search:
                                result["web_search"] = web_search
                        collected_sources.extend(
                            extract_sources_from_responses_web_search_call(item)
                        )

            if collected_sources:
                deduped_sources: list[dict[str, str]] = []
                seen_urls: set[str] = set()
                for source in collected_sources:
                    if not isinstance(source, dict):
                        continue
                    source_url = str(source.get("url") or "").strip()
                    if not source_url or source_url in seen_urls:
                        continue
                    seen_urls.add(source_url)
                    deduped_sources.append(
                        {
                            "title": str(source.get("title") or "").strip(),
                            "url": source_url,
                        }
                    )
                if deduped_sources:
                    result["sources"] = deduped_sources
                    if result["web_search"] is None:
                        synthetic_web_search = build_web_search_event_from_sources(
                            deduped_sources,
                            0,
                        )
                        if synthetic_web_search:
                            result["web_search"] = synthetic_web_search

            usage = response.get("usage")
            if isinstance(usage, dict):
                result["tokens"] = (
                    usage.get("output_tokens")
                    or usage.get("completion_tokens")
                    or usage.get("total_tokens")
                    or 0
                )
        return result

    if event_type == "error":
        error = chunk.get("error")
        if isinstance(error, dict):
            result["error"] = str(error.get("message") or "").strip() or str(error)
        else:
            result["error"] = str(error or chunk.get("message") or "").strip()
        return result

    if event_type == "response.failed":
        response = chunk.get("response")
        if isinstance(response, dict):
            error = response.get("error")
            if isinstance(error, dict):
                result["error"] = str(error.get("message") or "").strip() or str(error)
            elif error:
                result["error"] = str(error)
        if not result["error"]:
            result["error"] = "Responses 请求失败"
        return result

    return result


async def parse_responses_sse_stream(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    """解析 OpenAI Responses API SSE 事件流。"""
    buffer = ""

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

            yield parse_responses_chunk(chunk_json)


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
