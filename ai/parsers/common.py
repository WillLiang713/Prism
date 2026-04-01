import json
from typing import Any, AsyncIterator

import httpx


async def iter_sse_json(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
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
                yield json.loads(data)
            except json.JSONDecodeError:
                continue


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
                    if self._buffer[idx]["name"] != incoming_name:
                        if self._buffer[idx]["name"]:
                            self._buffer[idx]["name"] += func["name"]
                        else:
                            self._buffer[idx]["name"] = func["name"]
                if "arguments" in func and func["arguments"] is not None:
                    incoming_arguments = str(func["arguments"])
                    if self._buffer[idx]["arguments"] != incoming_arguments:
                        if self._buffer[idx]["arguments"]:
                            self._buffer[idx]["arguments"] += func["arguments"]
                        else:
                            self._buffer[idx]["arguments"] = func["arguments"]

    def valid_calls(self) -> dict[int, dict[str, str]]:
        return {
            idx: tc
            for idx, tc in self._buffer.items()
            if tc.get("name", "").strip()
        }


def summarize_tool_result(result: str) -> tuple[str, str, dict[str, Any] | None]:
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
            "title": (item.get("title") or "").strip(),
            "url": (item.get("url") or "").strip(),
        }
        for item in source_items
        if isinstance(item, dict) and (item.get("url") or "").strip()
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
    for item in source_items[:8]:
        if not isinstance(item, dict):
            continue

        title = str(item.get("title") or "").strip()
        source_url = str(item.get("url") or "").strip()
        content = str(
            item.get("content")
            or item.get("snippet")
            or item.get("summary")
            or item.get("text")
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

    sources: list[dict[str, str]] = []
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

    preview_results = [
        {
            "title": str(source.get("title") or "").strip(),
            "url": str(source.get("url") or "").strip(),
            "content": "",
        }
        for source in sources[:8]
    ]

    return {
        "status": "ready",
        "round": current_round,
        "name": "google_search",
        "query": query,
        "answer": "",
        "totalResults": len(sources),
        "results": preview_results,
    }
