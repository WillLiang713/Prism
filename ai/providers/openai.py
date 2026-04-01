from datetime import datetime
from urllib.parse import urlparse

import httpx

from ..builders.message_builder import convert_message_to_responses_input
from ..builders.prompt_renderer import resolve_system_prompt
from ..builders.tool_mapper import (
    build_responses_include,
    build_responses_tools,
    load_selected_tools,
)
from ..models import ChatRequest
from ..parsers.openai_chat import parse_openai_chat_sse_stream
from ..parsers.openai_responses import parse_responses_sse_stream
from .base import ProviderAdapter


class OpenAIAdapter(ProviderAdapter):
    provider_mode = "openai"
    DEFAULT_CHAT_URL = "https://api.openai.com/v1/chat/completions"
    DEFAULT_RESPONSES_URL = "https://api.openai.com/v1/responses"

    def build_api_url(
        self,
        provider: str,
        api_url: str | None,
        model: str | None = None,
        *,
        stream: bool = True,
        endpoint_mode: str = "chat_completions",
    ) -> str:
        url = self.normalize_api_url(api_url)

        if not url:
            if provider == "custom":
                raise ValueError("选择'自定义'时必须填写 API 地址")
            return (
                self.DEFAULT_RESPONSES_URL
                if endpoint_mode == "responses"
                else self.DEFAULT_CHAT_URL
            )

        url = url.rstrip("/")
        url_lower = url.lower()
        responses_suffix = "/responses"
        openai_suffix = "/chat/completions"
        anthropic_suffix = "/messages"
        models_suffix = "/models"
        target_suffix = responses_suffix if endpoint_mode == "responses" else openai_suffix

        if url_lower.endswith(openai_suffix):
            base = url[: -len(openai_suffix)]
            return f"{base}{target_suffix}"
        if url_lower.endswith(responses_suffix):
            base = url[: -len(responses_suffix)]
            return f"{base}{target_suffix}"
        if url_lower.endswith(models_suffix):
            base = url[: -len(models_suffix)]
            if base.lower().endswith("/v1"):
                return f"{base}{target_suffix}"
            return f"{base}/v1{target_suffix}"
        if anthropic_suffix in url_lower:
            raise ValueError("当前 API 地址是 Anthropic /messages 端点，不能用于 OpenAI 协议")
        if url_lower.endswith("/v1"):
            return f"{url}{target_suffix}"

        return f"{url}/v1{target_suffix}"

    def build_headers(self, api_key: str) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

    @staticmethod
    def _build_responses_reasoning(request: ChatRequest) -> dict[str, str] | None:
        if not request.reasoningEffort or request.reasoningEffort == "none":
            return None
        return {
            "effort": request.reasoningEffort,
            "summary": "auto",
        }

    @staticmethod
    def _is_image_generation_model(model: str | None) -> bool:
        model_name = str(model or "").strip().lower()
        if not model_name:
            return False
        return "image-preview" in model_name or model_name.startswith("imagen-")

    def build_chat_body(
        self,
        request: ChatRequest,
        current_user_content: str | list[dict[str, object]],
        history_messages: list[dict[str, object]],
    ) -> dict[str, object]:
        messages: list[dict[str, object]] = []

        system_text = resolve_system_prompt(request.systemPrompt, datetime.now())
        if system_text:
            messages.append({"role": "system", "content": system_text})

        messages.extend(history_messages)
        messages.append({"role": "user", "content": current_user_content})

        body: dict[str, object] = {
            "model": request.model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }

        if self._is_image_generation_model(request.model):
            body["modalities"] = ["image", "text"]

        tools = load_selected_tools(request)
        if tools:
            body["tools"] = tools

        if request.reasoningEffort and request.reasoningEffort != "none":
            body["reasoning_effort"] = request.reasoningEffort

        return body

    def build_messages_buffer(self, body: dict[str, object]) -> list[dict[str, object]]:
        return list(body.get("messages") or [])

    def build_next_body(
        self,
        body: dict[str, object],
        messages_with_tools: list[dict[str, object]],
    ) -> dict[str, object]:
        next_body = dict(body)
        next_body["messages"] = messages_with_tools
        return next_body

    def build_tool_followup_messages(
        self,
        request: ChatRequest,
        round_state: dict[str, object],
        valid_tool_calls: dict[int, dict[str, str]],
        executed_tools: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        assistant_message: dict[str, object] = {
            "role": "assistant",
            "tool_calls": [],
        }

        assistant_content = str(round_state.get("assistant_content") or "")
        assistant_thinking = str(round_state.get("assistant_thinking") or "")
        if assistant_content:
            assistant_message["content"] = assistant_content
        if assistant_thinking:
            model_lower = str(request.model or "").lower()
            if "deepseek" in model_lower or "o1" in model_lower:
                assistant_message["reasoning_content"] = assistant_thinking

        for executed_tool in executed_tools:
            assistant_message["tool_calls"].append(
                {
                    "id": executed_tool["call_id"],
                    "type": "function",
                    "function": {
                        "name": executed_tool["name"],
                        "arguments": executed_tool["raw_arguments"],
                    },
                }
            )

        tool_messages = [
            {
                "role": "tool",
                "tool_call_id": executed_tool["call_id"],
                "content": executed_tool["result"],
            }
            for executed_tool in executed_tools
        ]

        return [assistant_message, *tool_messages]

    async def parse_chat_stream(self, response: httpx.Response):
        async for item in parse_openai_chat_sse_stream(response):
            yield item

    def supports_responses(self) -> bool:
        return True

    def build_responses_body(
        self,
        request: ChatRequest,
        current_user_content: str | list[dict[str, object]],
        history_messages: list[dict[str, object]],
    ) -> dict[str, object]:
        instructions = resolve_system_prompt(request.systemPrompt, datetime.now())

        input_items: list[dict[str, object]] = []
        for message in history_messages:
            response_message = convert_message_to_responses_input(message)
            if response_message:
                input_items.append(response_message)

        current_message = convert_message_to_responses_input(
            {"role": "user", "content": current_user_content}
        )
        if current_message:
            input_items.append(current_message)

        body: dict[str, object] = {
            "model": request.model,
            "input": input_items,
            "stream": True,
        }

        if instructions:
            body["instructions"] = instructions

        reasoning = self._build_responses_reasoning(request)
        if reasoning:
            body["reasoning"] = reasoning

        response_tools = build_responses_tools(request)
        response_include = build_responses_include(request)

        if response_tools:
            body["tools"] = response_tools
        if response_include:
            body["include"] = response_include

        return body

    def build_responses_followup_body(
        self,
        request: ChatRequest,
        previous_response_id: str,
        tool_outputs: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        body: dict[str, object] = {
            "model": request.model,
            "previous_response_id": previous_response_id,
            "input": tool_outputs,
            "stream": True,
        }

        reasoning = self._build_responses_reasoning(request)
        if reasoning:
            body["reasoning"] = reasoning

        instructions = resolve_system_prompt(request.systemPrompt, datetime.now())
        if instructions:
            body["instructions"] = instructions

        if tools:
            body["tools"] = tools

        response_include = build_responses_include(request)
        if response_include:
            body["include"] = response_include

        return body

    def build_responses_manual_followup_body(
        self,
        request: ChatRequest,
        input_items: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        body: dict[str, object] = {
            "model": request.model,
            "input": input_items,
            "stream": True,
        }

        reasoning = self._build_responses_reasoning(request)
        if reasoning:
            body["reasoning"] = reasoning

        instructions = resolve_system_prompt(request.systemPrompt, datetime.now())
        if instructions:
            body["instructions"] = instructions

        if tools:
            body["tools"] = tools

        response_include = build_responses_include(request)
        if response_include:
            body["include"] = response_include

        return body

    async def parse_responses_stream(self, response: httpx.Response):
        async for item in parse_responses_sse_stream(response):
            yield item

    def build_title_request_body(
        self,
        model: str,
        user_prompt: str,
        system_prompt: str,
    ) -> dict[str, object]:
        return {
            "model": model,
            "max_tokens": 50,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.7,
        }

    def extract_text_response(self, data: dict[str, object]) -> str:
        return (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )

    def build_models_candidate_urls(self, api_url: str | None) -> list[str]:
        normalized = self.normalize_api_url(api_url)
        if not normalized:
            return ["https://api.openai.com/v1/models"]

        parsed = urlparse(normalized)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError("无法解析 API 地址（用于获取模型列表）")

        path = (parsed.path or "").rstrip("/")
        path_lower = path.lower()
        if "/v1" in path_lower:
            base_path = path[: path_lower.find("/v1") + 3]
        elif path_lower.endswith("/chat/completions"):
            base_path = path[: -len("/chat/completions")]
        elif path_lower.endswith("/responses"):
            base_path = path[: -len("/responses")]
        elif path_lower.endswith("/models"):
            base_path = path[: -len("/models")]
        else:
            base_path = path

        if not base_path:
            base_path = "/v1"
        elif not base_path.lower().endswith("/v1"):
            base_path = f"{base_path}/v1"

        return [f"{parsed.scheme}://{parsed.netloc}{base_path.rstrip('/')}/models"]

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
                if model_id:
                    model_ids.append(model_id)
            elif isinstance(item, str) and item.strip():
                model_ids.append(item.strip())

        return sorted(set(model_ids))
