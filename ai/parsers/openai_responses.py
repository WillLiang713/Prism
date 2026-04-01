from typing import Any

import httpx

from .common import iter_sse_json


def extract_sources_from_annotations(
    annotations: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
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

    parts: list[str] = []
    summaries = item.get("summary")
    if isinstance(summaries, list):
        for summary in summaries:
            if not isinstance(summary, dict):
                continue
            text = str(summary.get("text") or "").strip()
            if text:
                parts.append(text)
    if parts:
        return "\n".join(parts)

    content = item.get("content")
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = str(block.get("type") or "").strip()
            if block_type not in {"reasoning_text", "summary_text", "text"}:
                continue
            text = str(block.get("text") or "").strip()
            if text:
                parts.append(text)
    if parts:
        return "\n".join(parts)

    direct_text = str(
        item.get("text") or item.get("reasoning_text") or item.get("content_text") or ""
    ).strip()
    if direct_text:
        return direct_text

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


def parse_responses_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
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
        result["thinking"] = str(chunk.get("delta") or chunk.get("text") or "")
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
            collected_reasoning: list[str] = []
            if isinstance(output_items, list):
                for item in output_items:
                    if not isinstance(item, dict):
                        continue
                    item_type = str(item.get("type") or "").strip()
                    if item_type == "message":
                        _, annotations = _extract_text_and_annotations_from_response_item(item)
                        collected_sources.extend(extract_sources_from_annotations(annotations))
                    elif item_type == "reasoning":
                        reasoning_text = _extract_reasoning_text(item)
                        if reasoning_text:
                            collected_reasoning.append(reasoning_text)
                    elif item_type == "web_search_call":
                        if result["web_search"] is None:
                            web_search = build_responses_web_search_event(item, 0)
                            if web_search:
                                result["web_search"] = web_search
                        collected_sources.extend(
                            extract_sources_from_responses_web_search_call(item)
                        )

            if collected_reasoning:
                result["thinking"] = "\n\n".join(collected_reasoning)

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


async def parse_responses_sse_stream(response: httpx.Response):
    has_reasoning_summary = False
    has_streamed_reasoning = False

    async for chunk_json in iter_sse_json(response):
        event_type = str(chunk_json.get("type") or "").strip()

        if event_type == "response.reasoning_summary_part.added":
            if has_reasoning_summary:
                yield {
                    "thinking": "\n\n",
                    "content": "",
                    "tokens": None,
                    "tool": None,
                    "web_search": None,
                    "sources": None,
                    "error": None,
                    "call_id": "",
                    "response_id": str(chunk_json.get("response_id") or "").strip(),
                    "function_calls": None,
                    "response_output_items": None,
                }
            has_reasoning_summary = True
            continue

        parsed = parse_responses_chunk(chunk_json)

        if str(parsed.get("thinking") or "").strip() and event_type in {
            "response.reasoning_summary_text.delta",
            "response.reasoning_text.delta",
        }:
            has_streamed_reasoning = True

        if has_streamed_reasoning and event_type in {
            "response.output_item.done",
            "response.completed",
        }:
            item = chunk_json.get("item")
            item_type = str(item.get("type") or "").strip() if isinstance(item, dict) else ""
            if event_type == "response.completed" or item_type == "reasoning":
                parsed["thinking"] = ""

        yield parsed
