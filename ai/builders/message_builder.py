from dataclasses import dataclass
from typing import Any

from ..models import ChatRequest, HistoryTurn, ImageContent


@dataclass(slots=True)
class PreparedConversation:
    history_messages: list[dict[str, Any]]
    current_prompt: str
    current_user_content: str | list[dict[str, Any]]
    is_grok_proxy: bool


def _trim_history_text(text: str, limit: int) -> str:
    normalized = " ".join(str(text or "").split()).strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[:limit].rstrip() + "..."


def build_grok_proxy_context_prompt(
    history_turns: list[HistoryTurn],
    current_prompt: str,
    *,
    max_turns: int = 3,
) -> str:
    usable_turns: list[HistoryTurn] = []
    for turn in history_turns or []:
        if not isinstance(turn, HistoryTurn):
            continue
        if str(turn.prompt or "").strip():
            usable_turns.append(turn)

    if not usable_turns:
        return current_prompt

    selected_turns = usable_turns[-max_turns:]
    context_lines: list[str] = []
    for index, turn in enumerate(selected_turns, start=1):
        user_text = _trim_history_text(turn.prompt, 120)
        if user_text:
            context_lines.append(f"{index}. 用户问过：{user_text}")

        model_data = turn.models.get("main", {}) if isinstance(turn.models, dict) else {}
        assistant_text = ""
        if isinstance(model_data, dict) and str(model_data.get("status") or "") == "complete":
            assistant_text = _trim_history_text(
                str(model_data.get("content") or ""),
                160,
            )
        if assistant_text:
            context_lines.append(f"   已回答摘要：{assistant_text}")

    if not context_lines:
        return current_prompt

    current_text = str(current_prompt or "").strip()
    return (
        "以下是本轮问题的对话背景，仅用于帮助理解上下文。\n"
        "不要重复回答背景中的旧问题，不要复述背景里的旧答案，只回答最后这个问题。\n\n"
        "背景：\n"
        f"{chr(10).join(context_lines)}\n\n"
        "现在只回答这个问题：\n"
        f"{current_text}"
    ).strip()


def convert_history_to_messages(
    history_turns: list[HistoryTurn],
    side: str,
    provider_mode: str,
    *,
    include_assistant_history: bool = True,
) -> list[dict[str, Any]]:
    if not history_turns:
        return []

    messages: list[dict[str, Any]] = []

    for turn in history_turns:
        model_data = turn.models.get(side, {})
        assistant_content = str(model_data.get("content") or "")
        assistant_images = (
            model_data.get("images")
            if isinstance(model_data.get("images"), list)
            else []
        )
        if model_data.get("status") != "complete" or (
            not assistant_content and not assistant_images
        ):
            continue

        user_content = build_user_content(turn.prompt, turn.images, provider_mode)
        if provider_mode == "gemini":
            messages.append({"role": "user", "parts": user_content})
        else:
            messages.append({"role": "user", "content": user_content})

        if not include_assistant_history:
            continue

        if provider_mode == "gemini":
            assistant_parts = build_gemini_assistant_parts(
                assistant_content, assistant_images
            )
            if assistant_parts:
                messages.append({"role": "model", "parts": assistant_parts})
        elif provider_mode != "anthropic" and assistant_images:
            messages.append(
                {
                    "role": "assistant",
                    "content": build_openai_assistant_content(
                        assistant_content, assistant_images
                    ),
                }
            )
        elif assistant_content:
            messages.append({"role": "assistant", "content": assistant_content})

    return messages


def _extract_assistant_image_url(image: object) -> str:
    if isinstance(image, str):
        return image.strip()
    if not isinstance(image, dict):
        return ""

    direct_url = str(image.get("url") or image.get("dataUrl") or "").strip()
    if direct_url:
        return direct_url

    image_value = image.get("image_url")
    if isinstance(image_value, dict):
        return str(image_value.get("url") or "").strip()
    return str(image_value or "").strip()


def build_openai_assistant_content(
    text: str, images: list[object]
) -> str | list[dict[str, object]]:
    content: list[dict[str, object]] = []

    if text:
        content.append({"type": "text", "text": text})

    for image in images:
        image_url = _extract_assistant_image_url(image)
        if not image_url:
            continue
        content.append({"type": "image_url", "image_url": {"url": image_url}})

    if not content:
        return text
    if len(content) == 1 and content[0].get("type") == "text":
        return text
    return content


def build_gemini_assistant_parts(
    text: str, images: list[object]
) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []

    if text:
        parts.append({"text": text})

    for image in images:
        image_url = _extract_assistant_image_url(image)
        if not image_url.startswith("data:") or "," not in image_url:
            continue
        header, base64_data = image_url.split(",", 1)
        mime_type = "image/png"
        if ":" in header and ";" in header:
            mime_type = header.split(":", 1)[1].split(";", 1)[0]
        parts.append(
            {
                "inlineData": {
                    "mimeType": mime_type,
                    "data": base64_data,
                }
            }
        )

    return parts


def build_user_content(
    prompt: str,
    images: list[ImageContent],
    provider_mode: str,
) -> str | list[dict[str, Any]]:
    has_images = images and len(images) > 0

    if provider_mode == "gemini":
        return build_gemini_user_content(prompt, images)

    if not has_images:
        return prompt

    if provider_mode == "anthropic":
        content: list[dict[str, Any]] = []
        if prompt:
            content.append({"type": "text", "text": prompt})

        for img in images:
            parts = img.dataUrl.split(",", 1)
            if len(parts) != 2:
                continue
            header, base64_data = parts
            media_type = "image/png"
            if ":" in header and ";" in header:
                media_type = header.split(":")[1].split(";")[0]

            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": base64_data,
                    },
                }
            )

        return content

    content: list[dict[str, Any]] = []
    if prompt:
        content.append({"type": "text", "text": prompt})

    for img in images:
        content.append({"type": "image_url", "image_url": {"url": img.dataUrl}})

    return content


def build_gemini_user_content(
    prompt: str, images: list[ImageContent]
) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []

    if prompt:
        content.append({"text": prompt})

    for img in images or []:
        parts = str(img.dataUrl or "").split(",", 1)
        if len(parts) != 2:
            continue
        header, base64_data = parts
        mime_type = "image/png"
        if ":" in header and ";" in header:
            mime_type = header.split(":", 1)[1].split(";", 1)[0]
        content.append(
            {
                "inlineData": {
                    "mimeType": mime_type,
                    "data": base64_data,
                }
            }
        )

    return content


def convert_message_to_responses_input(
    message: dict[str, object],
) -> dict[str, object] | None:
    role = str(message.get("role") or "").strip()
    if role not in {"user", "assistant"}:
        return None

    text_item_type = "output_text" if role == "assistant" else "input_text"

    content = message.get("content")
    if isinstance(content, str):
        text = content.strip()
        if not text:
            return None
        return {
            "role": role,
            "content": [{"type": text_item_type, "text": text}],
        }

    if not isinstance(content, list):
        return None

    response_content: list[dict[str, object]] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        item_type = str(item.get("type") or "").strip()
        if item_type in {"text", "input_text", "output_text"}:
            text = str(item.get("text") or "").strip()
            if text:
                response_content.append({"type": text_item_type, "text": text})
        elif role == "user" and item_type in {"image_url", "input_image"}:
            image_value = item.get("image_url")
            image_url = ""
            detail = ""

            if isinstance(image_value, dict):
                image_url = str(image_value.get("url") or "").strip()
                detail = str(image_value.get("detail") or "").strip()
            else:
                image_url = str(image_value or "").strip()

            if image_url:
                image_item: dict[str, object] = {
                    "type": "input_image",
                    "image_url": image_url,
                }
                if detail:
                    image_item["detail"] = detail
                response_content.append(image_item)
        elif role == "assistant" and item_type == "refusal":
            refusal = str(item.get("refusal") or item.get("text") or "").strip()
            if refusal:
                response_content.append({"type": "refusal", "refusal": refusal})

    if not response_content:
        return None

    return {"role": role, "content": response_content}


def prepare_conversation(
    request: ChatRequest,
    provider_mode: str,
    *,
    is_grok_proxy: bool,
    side: str = "main",
) -> PreparedConversation:
    history_messages: list[dict[str, Any]] = []
    if request.historyTurns and not is_grok_proxy:
        history_messages = convert_history_to_messages(
            request.historyTurns,
            side,
            provider_mode,
        )

    current_prompt = request.prompt
    if is_grok_proxy and request.historyTurns:
        current_prompt = build_grok_proxy_context_prompt(
            request.historyTurns,
            request.prompt,
        )

    current_user_content = build_user_content(
        current_prompt,
        request.images,
        provider_mode,
    )

    return PreparedConversation(
        history_messages=history_messages,
        current_prompt=current_prompt,
        current_user_content=current_user_content,
        is_grok_proxy=is_grok_proxy,
    )
