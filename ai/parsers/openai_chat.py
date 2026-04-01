from typing import Any

import httpx

from .common import iter_sse_json


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


def parse_openai_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
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

        if "reasoning_content" in delta:
            result["thinking"] = delta["reasoning_content"]

        if "content" in delta:
            result["content"] = delta["content"]

        if "tool_calls" in delta and delta["tool_calls"]:
            result["tool_calls"] = delta["tool_calls"]

        images: list[dict[str, str]] = []
        _append_openai_images(images, delta.get("images"))
        _append_openai_images(images, message.get("images"))
        if images:
            result["images"] = images

    usage = chunk.get("usage", {})
    if usage:
        result["tokens"] = (
            usage.get("completion_tokens")
            or usage.get("output_tokens")
            or usage.get("total_tokens")
            or 0
        )

    return result


async def parse_openai_chat_sse_stream(response: httpx.Response):
    async for chunk_json in iter_sse_json(response):
        yield parse_openai_chunk(chunk_json)
