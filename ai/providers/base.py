from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator

import httpx

from ..models import ChatRequest


class ProviderAdapter(ABC):
    provider_mode: str = "openai"

    @staticmethod
    def normalize_api_url(api_url: str | None) -> str:
        url = (api_url or "").strip()
        if not url:
            return ""
        if "://" not in url:
            url = f"https://{url}"
        return url

    @abstractmethod
    def build_api_url(
        self,
        provider: str,
        api_url: str | None,
        model: str | None = None,
        *,
        stream: bool = True,
        endpoint_mode: str = "chat_completions",
    ) -> str:
        raise NotImplementedError

    @abstractmethod
    def build_headers(self, api_key: str) -> dict[str, str]:
        raise NotImplementedError

    @abstractmethod
    def build_chat_body(
        self,
        request: ChatRequest,
        current_user_content: str | list[dict[str, Any]],
        history_messages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def build_messages_buffer(self, body: dict[str, Any]) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def build_next_body(
        self,
        body: dict[str, Any],
        messages_with_tools: list[dict[str, Any]],
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def build_tool_followup_messages(
        self,
        request: ChatRequest,
        round_state: dict[str, Any],
        valid_tool_calls: dict[int, dict[str, str]],
        executed_tools: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def parse_chat_stream(
        self,
        response: httpx.Response,
    ) -> AsyncIterator[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def build_title_request_body(
        self,
        model: str,
        user_prompt: str,
        system_prompt: str,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def extract_text_response(self, data: dict[str, Any]) -> str:
        raise NotImplementedError

    def supports_responses(self) -> bool:
        return False

    def build_responses_body(
        self,
        request: ChatRequest,
        current_user_content: str | list[dict[str, Any]],
        history_messages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        raise NotImplementedError("当前提供商不支持 Responses API")

    def build_responses_followup_body(
        self,
        request: ChatRequest,
        previous_response_id: str,
        tool_outputs: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError("当前提供商不支持 Responses API")

    def build_responses_manual_followup_body(
        self,
        request: ChatRequest,
        input_items: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError("当前提供商不支持 Responses API")

    def parse_responses_stream(
        self,
        response: httpx.Response,
    ) -> AsyncIterator[dict[str, Any]]:
        raise NotImplementedError("当前提供商不支持 Responses API")

    def build_model_list_header_variants(self, api_key: str) -> list[dict[str, str]]:
        return [self.build_headers(api_key)]

    @abstractmethod
    def build_models_candidate_urls(self, api_url: str | None) -> list[str]:
        raise NotImplementedError

    @abstractmethod
    def extract_model_ids(self, data: Any) -> list[str]:
        raise NotImplementedError

    async def probe_model_connection(
        self,
        client: httpx.AsyncClient,
        provider: str,
        payload: Any,
        header_variants: list[dict[str, str]],
    ) -> tuple[bool, int, str]:
        return False, 502, ""
