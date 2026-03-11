import json
from typing import Any, AsyncIterator

import httpx


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
                usage.get("completion_tokens")
                or usage.get("output_tokens")
                or usage.get("total_tokens")
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
                self._buffer[idx] = {"id": "", "name": "", "arguments": ""}

            if "id" in tool_call:
                self._buffer[idx]["id"] = tool_call["id"]

            if "function" in tool_call:
                func = tool_call["function"]
                if "name" in func and func["name"] is not None:
                    self._buffer[idx]["name"] += func["name"]
                if "arguments" in func and func["arguments"] is not None:
                    self._buffer[idx]["arguments"] += func["arguments"]

    def valid_calls(self) -> dict[int, dict[str, str]]:
        return {
            idx: tc
            for idx, tc in self._buffer.items()
            if tc.get("name", "").strip()
        }


async def parse_sse_stream(response: httpx.Response, provider_mode: str) -> AsyncIterator[dict]:
    """统一 SSE 流解析：字节流 -> data 行 -> JSON -> 标准化 parsed 块。"""
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

            if provider_mode == "anthropic":
                yield StreamParser.parse_anthropic_chunk(chunk_json)
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
