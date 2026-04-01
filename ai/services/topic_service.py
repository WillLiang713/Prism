import re

import httpx

from ..providers import get_provider_adapter


class TopicService:
    @staticmethod
    def _normalize_compare_text(text: str) -> str:
        return re.sub(r"[\s\W_]+", "", str(text or ""), flags=re.UNICODE).lower()

    @staticmethod
    def _first_user_message(messages: list[dict[str, str]]) -> str:
        for msg in messages:
            if isinstance(msg, dict) and (msg.get("role") or "") == "user":
                text = str(msg.get("content") or "").strip()
                if text:
                    return text
        return ""

    @staticmethod
    def _fallback_title_from_messages(messages: list[dict[str, str]]) -> str:
        first = TopicService._first_user_message(messages)
        if not first:
            return "新对话"

        title = re.sub(r"\s+", " ", first).strip()
        title = title.splitlines()[0].strip()
        if not title:
            return "新对话"
        return title[:24]

    @staticmethod
    def _is_too_close_to_user_input(title: str, messages: list[dict[str, str]]) -> bool:
        first_user = TopicService._first_user_message(messages)
        if not first_user:
            return False
        normalized_title = TopicService._normalize_compare_text(title)
        normalized_user = TopicService._normalize_compare_text(first_user)
        if not normalized_title or not normalized_user:
            return False
        return normalized_title in normalized_user or normalized_user in normalized_title

    @staticmethod
    def _normalize_generated_title(
        raw_title: str,
        messages: list[dict[str, str]],
    ) -> tuple[str, str]:
        title = str(raw_title or "").strip()
        if not title:
            return TopicService._fallback_title_from_messages(messages), "fallback"

        title = title.splitlines()[0].strip()
        title = re.sub(r"^(标题|话题|主题)\s*[:：]\s*", "", title)
        title = re.sub(r"^[\-\*\d\.\)\(、\s]+", "", title)
        title = title.strip('"\'「」『』`')
        title = re.sub(r"\s+", " ", title).strip()

        if not title:
            return TopicService._fallback_title_from_messages(messages), "fallback"

        if re.search(r"(根据.*对话|建议标题|可以命名|这个对话|标题是)", title):
            return TopicService._fallback_title_from_messages(messages), "fallback"
        if title in {"新对话", "未命名", "对话"}:
            return TopicService._fallback_title_from_messages(messages), "fallback"

        if len(title) > 24:
            short = re.split(r"[，,。；;！？!?\|]", title, maxsplit=1)[0].strip()
            title = short if short else title[:24].strip()

        if TopicService._is_too_close_to_user_input(title, messages):
            return TopicService._fallback_title_from_messages(messages), "fallback"

        return title, "model"

    @staticmethod
    async def generate_title(payload):
        fallback_title = TopicService._fallback_title_from_messages(payload.messages)

        try:
            provider = str(payload.provider or "openai").strip()
            api_key = str(payload.apiKey or "").strip()
            model = str(payload.model or "").strip()

            if not api_key or not model:
                return {"title": fallback_title, "source": "fallback"}

            adapter = get_provider_adapter(provider)
            api_url = adapter.build_api_url(
                provider,
                payload.apiUrl,
                model,
                stream=False,
            )
            headers = adapter.build_headers(api_key)

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

            request_body = adapter.build_title_request_body(
                model,
                user_prompt,
                system_prompt,
            )

            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(api_url, json=request_body, headers=headers)

            if resp.status_code >= 400:
                return {"title": fallback_title, "source": "fallback"}

            title = adapter.extract_text_response(resp.json())
            title, source = TopicService._normalize_generated_title(title, payload.messages)
            return {"title": title, "source": source}

        except Exception:
            return {"title": fallback_title, "source": "fallback"}
