import json
from typing import Any

import httpx

from .common import iter_sse_json


def _build_data_url(mime_type: str, data: str) -> str:
    normalized_mime_type = str(mime_type or "").strip() or "image/png"
    return f"data:{normalized_mime_type};base64,{data}"


def parse_gemini_chunk(chunk: dict[str, Any]) -> dict[str, Any]:
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
                                "arguments": json.dumps(arguments, ensure_ascii=False),
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
                        data_value = str(inline_data.get("data") or "").strip()
                        if data_value:
                            mime_type = str(
                                inline_data.get("mimeType")
                                or inline_data.get("mime_type")
                                or "image/png"
                            ).strip() or "image/png"
                            images.append({"url": _build_data_url(mime_type, data_value)})

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


async def parse_gemini_sse_stream(response: httpx.Response):
    async for chunk_json in iter_sse_json(response):
        yield parse_gemini_chunk(chunk_json)
