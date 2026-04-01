from datetime import datetime
from urllib.parse import urlparse

import httpx

from ..builders.prompt_renderer import resolve_system_prompt
from ..builders.tool_mapper import build_anthropic_tools
from ..models import ChatRequest
from ..parsers.anthropic import parse_anthropic_sse_stream
from .base import ProviderAdapter


class AnthropicAdapter(ProviderAdapter):
    provider_mode = "anthropic"
    DEFAULT_MESSAGES_URL = "https://api.anthropic.com/v1/messages"

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
            return self.DEFAULT_MESSAGES_URL

        url = url.rstrip("/")
        url_lower = url.lower()
        anthropic_suffix = "/messages"
        if anthropic_suffix not in url_lower:
            if url_lower.endswith("/v1"):
                return f"{url}{anthropic_suffix}"
            return f"{url}/v1{anthropic_suffix}"
        return url

    def build_headers(self, api_key: str) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        }

    def build_chat_body(
        self,
        request: ChatRequest,
        current_user_content: str | list[dict[str, object]],
        history_messages: list[dict[str, object]],
    ) -> dict[str, object]:
        body: dict[str, object] = {
            "model": request.model,
            "messages": [
                *history_messages,
                {"role": "user", "content": current_user_content},
            ],
            "stream": True,
            "max_tokens": 4096,
        }

        system_text = resolve_system_prompt(request.systemPrompt, datetime.now())
        if system_text:
            body["system"] = system_text

        tools = build_anthropic_tools(request)
        if tools:
            body["tools"] = tools

        if request.reasoningEffort and request.reasoningEffort != "none":
            budget_map = {
                "minimal": 512,
                "low": 1024,
                "medium": 2048,
                "high": 4096,
                "xhigh": 8192,
            }
            body["thinking"] = {
                "type": "enabled",
                "budget_tokens": budget_map.get(request.reasoningEffort, 2048),
            }

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
        assistant_content_blocks = list(round_state.get("assistant_blocks") or [])
        if not assistant_content_blocks and round_state.get("assistant_content"):
            assistant_content_blocks.append(
                {
                    "type": "text",
                    "text": str(round_state.get("assistant_content") or ""),
                }
            )

        if not assistant_content_blocks:
            for executed_tool in executed_tools:
                assistant_content_blocks.append(
                    {
                        "type": "tool_use",
                        "id": executed_tool["call_id"],
                        "name": executed_tool["name"],
                        "input": executed_tool["args"],
                    }
                )

        assistant_message = {
            "role": "assistant",
            "content": assistant_content_blocks,
        }

        anthropic_tool_results: list[dict[str, object]] = []
        for executed_tool in executed_tools:
            tool_result = {
                "type": "tool_result",
                "tool_use_id": executed_tool["call_id"],
                "content": executed_tool["result"],
            }
            if executed_tool["status"] == "error":
                tool_result["is_error"] = True
            anthropic_tool_results.append(tool_result)

        messages: list[dict[str, object]] = []
        if assistant_content_blocks:
            messages.append(assistant_message)
        if anthropic_tool_results:
            messages.append({"role": "user", "content": anthropic_tool_results})
        return messages

    async def parse_chat_stream(self, response: httpx.Response):
        async for item in parse_anthropic_sse_stream(response):
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
            "messages": [{"role": "user", "content": user_prompt}],
            "system": system_prompt,
        }

    def extract_text_response(self, data: dict[str, object]) -> str:
        return str(data.get("content", [{}])[0].get("text", "")).strip()

    def build_model_list_header_variants(self, api_key: str) -> list[dict[str, str]]:
        headers = self.build_headers(api_key)
        variants = [
            headers,
            {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
                "anthropic-version": headers.get("anthropic-version", "2023-06-01"),
            },
            {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        ]

        deduped: list[dict[str, str]] = []
        seen: set[tuple[tuple[str, str], ...]] = set()
        for variant in variants:
            identity = tuple(sorted(variant.items()))
            if identity in seen:
                continue
            seen.add(identity)
            deduped.append(variant)
        return deduped

    def build_models_candidate_urls(self, api_url: str | None) -> list[str]:
        normalized = self.normalize_api_url(api_url)
        if not normalized:
            return ["https://api.anthropic.com/v1/models"]

        parsed = urlparse(normalized)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError("无法解析 API 地址（用于获取模型列表）")

        path = (parsed.path or "").rstrip("/")
        path_lower = path.lower()
        if "/v1" in path_lower:
            base_path = path[: path_lower.find("/v1") + 3]
        elif path_lower.endswith("/messages"):
            base_path = path[: -len("/messages")]
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

    async def probe_model_connection(
        self,
        client: httpx.AsyncClient,
        provider: str,
        payload,
        header_variants: list[dict[str, str]],
    ) -> tuple[bool, int, str]:
        model = str(getattr(payload, "model", "") or "").strip()
        if not model:
            return (
                False,
                400,
                "模型列表接口不可用，且当前未填写模型 ID，无法继续验证 Messages 接口",
            )

        api_url = self.build_api_url(
            provider,
            getattr(payload, "apiUrl", None),
            model,
            stream=False,
        )
        probe_body = {
            "model": model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "ping"}],
        }

        last_status = 502
        last_detail = "Anthropic Messages 接口探测失败"
        for headers in header_variants:
            response = await client.post(api_url, headers=headers, json=probe_body)
            try:
                data = response.json()
            except Exception:
                data = None

            if response.status_code < 400:
                return True, response.status_code, ""

            last_status = response.status_code
            if isinstance(data, dict):
                error = data.get("error")
                if isinstance(error, dict) and isinstance(error.get("message"), str):
                    last_detail = error["message"]
                elif isinstance(data.get("message"), str):
                    last_detail = data["message"]
                elif isinstance(error, str):
                    last_detail = error
                else:
                    last_detail = response.text or response.reason_phrase or last_detail
            else:
                last_detail = response.text or response.reason_phrase or last_detail

        return False, last_status, last_detail
