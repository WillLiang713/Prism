import re

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai import ProviderConfig


router = APIRouter(prefix="/api")


class GenerateTitleRequest(BaseModel):
    provider: str = Field(default="openai")
    apiKey: str | None = None
    model: str | None = None
    apiUrl: str | None = None
    messages: list[dict[str, str]]


def _normalize_compare_text(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", str(text or ""), flags=re.UNICODE).lower()


def _first_user_message(messages: list[dict[str, str]]) -> str:
    for msg in messages:
        if isinstance(msg, dict) and (msg.get("role") or "") == "user":
            text = str(msg.get("content") or "").strip()
            if text:
                return text
    return ""


def _fallback_title_from_messages(messages: list[dict[str, str]]) -> str:
    first = _first_user_message(messages)
    if not first:
        return "新对话"

    title = re.sub(r"\s+", " ", first).strip()
    title = title.splitlines()[0].strip()
    if not title:
        return "新对话"
    return title[:24]


def _is_too_close_to_user_input(title: str, messages: list[dict[str, str]]) -> bool:
    first_user = _first_user_message(messages)
    if not first_user:
        return False
    t = _normalize_compare_text(title)
    u = _normalize_compare_text(first_user)
    if not t or not u:
        return False
    return t in u or u in t


def _normalize_generated_title(raw_title: str, messages: list[dict[str, str]]) -> tuple[str, str]:
    title = str(raw_title or "").strip()
    if not title:
        return _fallback_title_from_messages(messages), "fallback"

    title = title.splitlines()[0].strip()
    title = re.sub(r"^(标题|话题|主题)\s*[:：]\s*", "", title)
    title = re.sub(r"^[\-\*\d\.\)\(、\s]+", "", title)
    title = title.strip('"\'「」『』`')
    title = re.sub(r"\s+", " ", title).strip()

    if not title:
        return _fallback_title_from_messages(messages), "fallback"

    if re.search(r"(根据.*对话|建议标题|可以命名|这个对话|标题是)", title):
        return _fallback_title_from_messages(messages), "fallback"
    if title in {"新对话", "未命名", "对话"}:
        return _fallback_title_from_messages(messages), "fallback"

    if len(title) > 24:
        short = re.split(r"[，,。；;！？!?\|]", title, maxsplit=1)[0].strip()
        title = short if short else title[:24].strip()

    if _is_too_close_to_user_input(title, messages):
        return _fallback_title_from_messages(messages), "fallback"

    return title, "model"


@router.post("/topics/generate-title")
async def generate_topic_title(payload: GenerateTitleRequest):
    try:
        provider = str(payload.provider or "openai").strip()
        api_key = str(payload.apiKey or "").strip()
        model = str(payload.model or "").strip()
        api_url = str(payload.apiUrl or "").strip() or None

        if not api_key:
            raise HTTPException(status_code=400, detail="缺少 API Key")
        if not model:
            raise HTTPException(status_code=400, detail="缺少模型 ID")

        system_prompt = (
            "你是话题标题生成助手。请基于对话语义生成4-12字的中文名词短语标题。"
            "禁止复述用户原句，禁止输出解释，禁止使用“这个对话”“标题是”等表述。"
            "只输出标题文本。"
        )

        conversation_summary = []
        for msg in payload.messages[:6]:
            role = msg.get("role", "")
            content = msg.get("content", "")[:200]
            if role and content:
                conversation_summary.append(f"{role}: {content}")

        user_prompt = (
            "请为以下对话生成一个简洁标题（4-12字，概括意图，不要复述原句）：\n\n"
            + "\n".join(conversation_summary)
        )

        provider_mode = "anthropic" if provider == "anthropic" else "openai"
        api_url = ProviderConfig.get_api_url(provider, api_url, provider_mode)

        if provider_mode == "anthropic":
            request_body = {
                "model": model,
                "max_tokens": 50,
                "messages": [{"role": "user", "content": user_prompt}],
                "system": system_prompt,
                "temperature": 0.7,
            }
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
        else:
            request_body = {
                "model": model,
                "max_tokens": 50,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.7,
            }
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(api_url, json=request_body, headers=headers)

        if resp.status_code >= 400:
            try:
                error_data = resp.json()
                error_message = error_data.get("error", {}).get("message", resp.text)
            except Exception:
                error_message = resp.text
            raise HTTPException(status_code=resp.status_code, detail=f"AI请求失败: {error_message}")

        data = resp.json()
        if provider_mode == "anthropic":
            title = data.get("content", [{}])[0].get("text", "").strip()
        else:
            title = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

        title, source = _normalize_generated_title(title, payload.messages)
        return {"title": title, "source": source}

    except HTTPException:
        raise
    except Exception as e:
        print(f"生成标题错误: {type(e).__name__} - {e}")
        raise HTTPException(status_code=500, detail=f"生成标题失败: {str(e)}")
