from datetime import datetime
from urllib.parse import quote, urlparse

import httpx

from ..builders.prompt_renderer import (
    render_system_prompt_template,
    resolve_system_prompt,
)
from ..builders.tool_mapper import build_gemini_tools
from ..models import ChatRequest
from ..parsers.gemini import parse_gemini_sse_stream
from .base import ProviderAdapter


class GeminiAdapter(ProviderAdapter):
    provider_mode = "gemini"
    DEFAULT_API_URL = "https://generativelanguage.googleapis.com/v1beta"

    def _normalize_gemini_base_url(self, api_url: str | None) -> str:
        normalized = self.normalize_api_url(api_url).rstrip("/")
        lowered = normalized.lower()

        model_marker = "/models/"
        if model_marker in lowered:
            model_index = lowered.find(model_marker)
            normalized = normalized[:model_index]
            lowered = normalized.lower()

        for suffix in (":streamgeneratecontent", ":generatecontent", ":counttokens"):
            if lowered.endswith(suffix):
                normalized = normalized[: -len(suffix)]
                lowered = normalized.lower()

        if lowered.endswith("/models"):
            normalized = normalized[: -len("/models")]
            lowered = normalized.lower()

        if "?" in normalized:
            normalized = normalized.split("?", 1)[0]

        if not lowered.endswith("/v1beta") and not lowered.endswith("/v1"):
            normalized = f"{normalized}/v1beta"

        return normalized

    def build_api_url(
        self,
        provider: str,
        api_url: str | None,
        model: str | None = None,
        *,
        stream: bool = True,
        endpoint_mode: str = "chat_completions",
    ) -> str:
        if not model:
            raise ValueError("Gemini 请求必须提供模型名称")

        base_url = self._normalize_gemini_base_url(api_url or self.DEFAULT_API_URL)
        method = "streamGenerateContent" if stream else "generateContent"
        encoded_model = quote(str(model).strip().removeprefix("models/"), safe="")
        final_url = f"{base_url}/models/{encoded_model}:{method}"
        if stream:
            final_url = f"{final_url}?alt=sse"
        return final_url

    def build_headers(self, api_key: str) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        }

    @staticmethod
    def _is_image_generation_model(model: str | None) -> bool:
        model_name = str(model or "").strip().lower()
        if not model_name:
            return False
        return "image-preview" in model_name or model_name.startswith("imagen-")

    @staticmethod
    def _map_reasoning_effort_to_budget(reasoning_effort: str | None) -> int | None:
        effort = str(reasoning_effort or "").strip().lower()
        budget_map = {
            "none": 0,
            "minimal": 512,
            "low": 1024,
            "medium": 2048,
            "high": 4096,
            "xhigh": 8192,
        }
        if effort not in budget_map:
            return 2048
        return budget_map[effort]

    def build_chat_body(
        self,
        request: ChatRequest,
        current_user_content: str | list[dict[str, object]],
        history_messages: list[dict[str, object]],
    ) -> dict[str, object]:
        body: dict[str, object] = {
            "contents": [*history_messages, {"role": "user", "parts": current_user_content}],
        }

        system_text = resolve_system_prompt(request.systemPrompt, datetime.now())
        if system_text:
            body["system_instruction"] = {"parts": [{"text": system_text}]}

        tools = build_gemini_tools(request)
        if tools:
            body["tools"] = tools

        has_custom_function_tools = any(
            isinstance(tool, dict) and isinstance(tool.get("function_declarations"), list)
            for tool in tools
        )
        if request.enableTools and has_custom_function_tools:
            body["tool_config"] = {"function_calling_config": {"mode": "auto"}}

        generation_config: dict[str, object] = {}
        if self._is_image_generation_model(request.model):
            generation_config["responseModalities"] = ["IMAGE", "TEXT"]

        thinking_budget = self._map_reasoning_effort_to_budget(request.reasoningEffort)
        if thinking_budget is not None:
            generation_config["thinkingConfig"] = {
                "thinkingBudget": thinking_budget,
                "includeThoughts": True,
            }

        if generation_config:
            body["generationConfig"] = generation_config

        return body

    def build_messages_buffer(self, body: dict[str, object]) -> list[dict[str, object]]:
        return list(body.get("contents") or [])

    def build_next_body(
        self,
        body: dict[str, object],
        messages_with_tools: list[dict[str, object]],
    ) -> dict[str, object]:
        next_body = dict(body)
        next_body["contents"] = messages_with_tools
        return next_body

    def build_tool_followup_messages(
        self,
        request: ChatRequest,
        round_state: dict[str, object],
        valid_tool_calls: dict[int, dict[str, str]],
        executed_tools: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        parts = list(round_state.get("gemini_model_parts") or [])
        if not parts and round_state.get("assistant_content"):
            parts.append({"text": str(round_state["assistant_content"])})

        has_function_call = any(
            isinstance(part, dict) and isinstance(part.get("functionCall"), dict)
            for part in parts
        )
        if not has_function_call:
            executed_by_name = {
                str(item.get("name") or ""): item for item in executed_tools
            }
            for _, tool_call in sorted(valid_tool_calls.items()):
                executed_tool = executed_by_name.get(str(tool_call.get("name") or ""))
                part = {
                    "functionCall": {
                        "name": tool_call.get("name") or "",
                        "args": executed_tool.get("args", {}) if executed_tool else {},
                    }
                }
                thought_signature = str(tool_call.get("thought_signature") or "")
                if thought_signature:
                    part["thoughtSignature"] = thought_signature
                parts.append(part)

        function_responses = [
            {
                "functionResponse": {
                    "name": executed_tool["name"],
                    "response": executed_tool["normalized_result"],
                }
            }
            for executed_tool in executed_tools
        ]

        messages: list[dict[str, object]] = []
        if parts:
            messages.append({"role": "model", "parts": parts})
        if function_responses:
            messages.append({"role": "user", "parts": function_responses})
        return messages

    async def parse_chat_stream(self, response: httpx.Response):
        async for item in parse_gemini_sse_stream(response):
            yield item

    def build_title_request_body(
        self,
        model: str,
        user_prompt: str,
        system_prompt: str,
    ) -> dict[str, object]:
        rendered_system_prompt = render_system_prompt_template(
            system_prompt, datetime.now()
        )
        return {
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "system_instruction": {"parts": [{"text": rendered_system_prompt}]},
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 50,
            },
        }

    def extract_text_response(self, data: dict[str, object]) -> str:
        title_parts = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [])
        )
        texts = []
        for part in title_parts:
            if isinstance(part, dict) and part.get("text") and not part.get("thought"):
                texts.append(str(part.get("text") or ""))
        return "".join(texts).strip()

    def build_models_candidate_urls(self, api_url: str | None) -> list[str]:
        normalized = self.normalize_api_url(api_url)
        if not normalized:
            return [
                "https://generativelanguage.googleapis.com/v1beta/models",
                "https://generativelanguage.googleapis.com/v1/models",
            ]

        parsed = urlparse(normalized)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError("无法解析 API 地址（用于获取模型列表）")

        path = (parsed.path or "").rstrip("/")
        path_lower = path.lower()
        if "/models/" in path_lower:
            base_path = path[: path_lower.find("/models/")]
        elif path_lower.endswith("/models"):
            base_path = path[: -len("/models")]
        elif ":generatecontent" in path_lower:
            base_path = path.split(":", 1)[0]
            if "/models/" in base_path.lower():
                base_path = base_path[: base_path.lower().find("/models/")]
        elif path_lower.endswith("/v1beta") or path_lower.endswith("/v1"):
            base_path = path
        else:
            base_path = path

        if not base_path:
            base_path = "/v1beta"
        elif not base_path.lower().endswith("/v1beta") and not base_path.lower().endswith("/v1"):
            base_path = f"{base_path}/v1beta"

        base = f"{parsed.scheme}://{parsed.netloc}{base_path}".rstrip("/")
        candidates = [f"{base}/models"]

        lowered = base.lower()
        alternate_base = ""
        if lowered.endswith("/v1beta"):
            alternate_base = f"{base[:-len('/v1beta')]}/v1"
        elif lowered.endswith("/v1"):
            alternate_base = f"{base[:-len('/v1')]}/v1beta"

        alternate = alternate_base.rstrip("/")
        if alternate:
            alternate_url = f"{alternate}/models"
            if alternate_url not in candidates:
                candidates.append(alternate_url)

        return candidates

    def extract_model_ids(self, data):
        items = []
        if isinstance(data, dict) and isinstance(data.get("data"), list):
            items = data["data"]
        elif isinstance(data, dict) and isinstance(data.get("models"), list):
            items = data["models"]
        elif isinstance(data, list):
            items = data

        model_ids: list[str] = []
        for item in items:
            if isinstance(item, dict):
                model_id = (
                    item.get("id") or item.get("name") or item.get("model") or ""
                ).strip()
                if model_id.startswith("models/"):
                    model_id = model_id[len("models/") :]
                if model_id:
                    model_ids.append(model_id)
            elif isinstance(item, str) and item.strip():
                model_id = item.strip()
                if model_id.startswith("models/"):
                    model_id = model_id[len("models/") :]
                model_ids.append(model_id)

        return sorted(set(model_ids))
