import json
from typing import Any

import httpx

from .common import iter_sse_json


def parse_anthropic_chunk(
    chunk: dict[str, Any],
    content_blocks_state: dict[int, dict[str, Any]] | None = None,
    tool_use_state: dict[int, dict[str, str]] | None = None,
) -> dict[str, Any]:
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
                "function": {"name": str(content_block.get("name") or "")},
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
                content_blocks_state[index]["signature"] = str(delta.get("signature") or "")
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
                    and content_blocks_state[index].get("type") in {"tool_use", "server_tool_use"}
                ):
                    content_blocks_state[index]["_input_json_buffer"] = (
                        str(content_blocks_state[index].get("_input_json_buffer") or "")
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
                        "function": {"arguments": partial_json},
                    }
                ]
    elif chunk_type == "content_block_stop":
        index = int(chunk.get("index") or 0)
        if content_blocks_state is not None:
            completed_block = content_blocks_state.pop(index, None)
            if isinstance(completed_block, dict):
                if completed_block.get("type") in {"tool_use", "server_tool_use"}:
                    input_json = str(completed_block.pop("_input_json_buffer", "") or "")
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


async def parse_anthropic_sse_stream(response: httpx.Response):
    content_blocks_state: dict[int, dict[str, Any]] = {}
    tool_use_state: dict[int, dict[str, str]] = {}

    async for chunk_json in iter_sse_json(response):
        yield parse_anthropic_chunk(
            chunk_json,
            content_blocks_state,
            tool_use_state,
        )


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
        and (
            str(source.get("title") or "").strip()
            or str(source.get("url") or "").strip()
        )
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
