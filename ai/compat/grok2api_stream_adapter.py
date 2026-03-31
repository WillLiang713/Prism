import json
import re
import uuid
from typing import Any

from ..models import ChatRequest


class Grok2ApiStreamAdapter:
    """兼容 grok2api 将思考和搜索轨迹混入 content 的输出。"""

    _THINK_START_TAG = "<think>"
    _THINK_END_TAG = "</think>"
    _REPLAY_EXACT_MIN_CHARS = 24
    _REPLAY_PREFIX_MIN_CHARS = 80
    _SEARCH_LABEL_RE = re.compile(
        r"^(?:\[[^\]]+\])?\[(WebSearch|SearchImage|AgentThink)\]\s*",
        re.IGNORECASE,
    )
    _SEARCH_TOOL_RE = re.compile(
        r"^(x_[a-z0-9_]+|[a-z0-9_]*keyword_search)\b",
        re.IGNORECASE,
    )
    _MAX_PREFIX_BUFFER = 4096

    def __init__(self, request: ChatRequest, round_number: int = 0):
        model = str(request.model or "").strip().lower()
        api_url = str(request.apiUrl or "").strip().lower()
        upstream_is_grok_proxy = (
            "grok2api" in api_url
            or "grok.com" in api_url
            or (model.startswith("grok-") and api_url and "x.ai" not in api_url)
        )
        self.enabled = upstream_is_grok_proxy or model.startswith("grok-")
        self.round_number = round_number
        self._in_think = False
        self._tag_partial = ""
        self._prefix_mode = upstream_is_grok_proxy
        self._prefix_buffer = ""
        self._artifact_lines: list[str] = []
        self._artifact_query = ""
        self._web_search_emitted = False
        self._call_id = f"grok_compat_{uuid.uuid4().hex[:10]}"
        self._previous_assistant_content = self._extract_previous_assistant_content(
            request
        )
        self._replay_buffer = ""
        self._replay_resolved = not (
            upstream_is_grok_proxy and self._previous_assistant_content
        )

    @staticmethod
    def _suffix_prefix(text: str, tag: str) -> int:
        if not text or not tag:
            return 0
        max_keep = min(len(text), len(tag) - 1)
        for keep in range(max_keep, 0, -1):
            if text.endswith(tag[:keep]):
                return keep
        return 0

    @staticmethod
    def _extract_query_from_label(text: str) -> str:
        normalized = Grok2ApiStreamAdapter._SEARCH_LABEL_RE.sub("", text, count=1)
        normalized = normalized.strip()
        if not normalized:
            return ""
        tool_match = Grok2ApiStreamAdapter._SEARCH_TOOL_RE.search(normalized)
        if tool_match:
            normalized = normalized[: tool_match.start()].strip()
        normalized = Grok2ApiStreamAdapter._SEARCH_LABEL_RE.sub(
            "", normalized
        ).strip()
        return normalized

    @staticmethod
    def _consume_leading_json(text: str) -> tuple[str, str] | None:
        if not text.startswith("{"):
            return None
        depth = 0
        in_string = False
        escape = False
        for index, char in enumerate(text):
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
                continue
            if char == "{":
                depth += 1
                continue
            if char == "}":
                depth -= 1
                if depth == 0:
                    return text[: index + 1], text[index + 1 :]
        return None

    def _record_artifact(self, artifact: str) -> None:
        cleaned = str(artifact or "").strip()
        if not cleaned:
            return
        self._artifact_lines.append(cleaned)

        label_query = self._extract_query_from_label(cleaned)
        if label_query and not self._artifact_query:
            self._artifact_query = label_query

        if cleaned.startswith("{"):
            try:
                payload = json.loads(cleaned)
            except Exception:
                payload = None
            if isinstance(payload, dict):
                query_value = str(payload.get("query") or payload.get("q") or "").strip()
                if query_value:
                    self._artifact_query = query_value

    @staticmethod
    def _extract_previous_assistant_content(request: ChatRequest) -> str:
        history_turns = request.historyTurns if isinstance(request.historyTurns, list) else []
        for turn in reversed(history_turns):
            models = getattr(turn, "models", None)
            if not isinstance(models, dict):
                continue
            model_data = models.get("main")
            if not isinstance(model_data, dict):
                continue
            if str(model_data.get("status") or "").strip().lower() != "complete":
                continue
            assistant_content = str(model_data.get("content") or "")
            if assistant_content:
                return assistant_content
        return ""

    @staticmethod
    def _common_prefix_length(left: str, right: str) -> int:
        max_length = min(len(left), len(right))
        index = 0
        while index < max_length and left[index] == right[index]:
            index += 1
        return index

    def _drain_replay_buffer(
        self, result: dict[str, list[Any]], *, flush: bool = False
    ) -> None:
        if self._replay_resolved:
            if self._replay_buffer:
                result["content"].append(self._replay_buffer)
                self._replay_buffer = ""
            return

        if not self._replay_buffer:
            return

        previous = self._previous_assistant_content
        if not previous:
            self._replay_resolved = True
            result["content"].append(self._replay_buffer)
            self._replay_buffer = ""
            return

        common = self._common_prefix_length(self._replay_buffer, previous)

        # 仍然只是“旧答案前缀”的时候先继续观望，等后续 chunk 再判断。
        if (
            not flush
            and common == len(self._replay_buffer)
            and common <= len(previous)
        ):
            return

        should_strip_replay = (
            common == len(previous)
            and len(previous) >= self._REPLAY_EXACT_MIN_CHARS
            and len(self._replay_buffer) > len(previous)
        ) or (
            common >= self._REPLAY_PREFIX_MIN_CHARS
            and len(self._replay_buffer) > common
        )

        if should_strip_replay:
            remaining = self._replay_buffer[common:]
            if remaining:
                result["content"].append(remaining)
        else:
            result["content"].append(self._replay_buffer)

        self._replay_buffer = ""
        self._replay_resolved = True

    def _append_visible_content(
        self, result: dict[str, list[Any]], text: str, *, flush: bool = False
    ) -> None:
        if self._replay_resolved:
            if text:
                result["content"].append(text)
            return

        if text:
            self._replay_buffer += text
        self._drain_replay_buffer(result, flush=flush)

    def _emit_web_search_event(self, result: dict[str, list[Any]]) -> None:
        if self._web_search_emitted or not self._artifact_lines:
            return
        answer = "\n".join(self._artifact_lines).strip()
        result["web_search"].append(
            {
                "callId": self._call_id,
                "round": self.round_number,
                "status": "success",
                "name": "web_search",
                "query": self._artifact_query,
                "answer": answer,
                "results": [],
                "totalResults": 0,
            }
        )
        self._web_search_emitted = True

    def _consume_search_artifact(
        self, text: str, *, flush: bool
    ) -> tuple[str, str] | None:
        label_match = self._SEARCH_LABEL_RE.match(text)
        if label_match:
            newline_idx = text.find("\n")
            brace_idx = text.find("{")
            if brace_idx != -1 and (newline_idx == -1 or brace_idx < newline_idx):
                return text[:brace_idx], text[brace_idx:]
            if newline_idx != -1:
                return text[: newline_idx + 1], text[newline_idx + 1 :]
            if flush:
                return text, ""
            return None

        tool_match = self._SEARCH_TOOL_RE.match(text)
        if tool_match:
            newline_idx = text.find("\n")
            brace_idx = text.find("{")
            if brace_idx != -1 and (newline_idx == -1 or brace_idx < newline_idx):
                return text[:brace_idx], text[brace_idx:]
            if newline_idx != -1:
                return text[: newline_idx + 1], text[newline_idx + 1 :]
            if flush:
                return text, ""
            return None

        json_segment = self._consume_leading_json(text)
        if json_segment:
            return json_segment
        if text.startswith("{") and flush:
            return text, ""
        return None

    def _drain_prefix_buffer(
        self, result: dict[str, list[Any]], *, flush: bool = False
    ) -> None:
        if not self._prefix_mode:
            if self._prefix_buffer:
                self._append_visible_content(result, self._prefix_buffer, flush=flush)
                self._prefix_buffer = ""
            return

        while True:
            if not self._prefix_buffer:
                return

            stripped = self._prefix_buffer.lstrip()
            if not stripped:
                if flush:
                    self._append_visible_content(
                        result, self._prefix_buffer, flush=True
                    )
                    self._prefix_buffer = ""
                    self._prefix_mode = False
                return

            consumed = self._consume_search_artifact(stripped, flush=flush)
            if consumed:
                artifact, remainder = consumed
                self._record_artifact(artifact)
                self._prefix_buffer = remainder.lstrip()
                continue

            if flush or len(self._prefix_buffer) >= self._MAX_PREFIX_BUFFER:
                self._emit_web_search_event(result)
                self._append_visible_content(result, stripped, flush=flush)
                self._prefix_buffer = ""
                self._prefix_mode = False
                return

            self._emit_web_search_event(result)
            self._append_visible_content(result, stripped, flush=False)
            self._prefix_buffer = ""
            self._prefix_mode = False
            return

    def _append_outside_text(
        self, result: dict[str, list[Any]], text: str, *, flush: bool = False
    ) -> None:
        if not self._prefix_mode:
            self._append_visible_content(result, text, flush=flush)
            return

        if text:
            self._prefix_buffer += text
        self._drain_prefix_buffer(result, flush=flush)

    def process_content(self, text: str) -> dict[str, list[Any]]:
        result: dict[str, list[Any]] = {
            "thinking": [],
            "content": [],
            "web_search": [],
        }
        if not text:
            return result
        if not self.enabled:
            result["content"].append(text)
            return result

        data = f"{self._tag_partial}{text}"
        self._tag_partial = ""

        while data:
            tag = self._THINK_END_TAG if self._in_think else self._THINK_START_TAG
            tag_index = data.find(tag)
            if tag_index == -1:
                keep = self._suffix_prefix(data, tag)
                emit = data[:-keep] if keep else data
                if self._in_think:
                    if emit:
                        result["thinking"].append(emit)
                else:
                    self._append_outside_text(result, emit, flush=False)
                self._tag_partial = data[-keep:] if keep else ""
                break

            before = data[:tag_index]
            if self._in_think:
                if before:
                    result["thinking"].append(before)
                data = data[tag_index + len(tag) :]
                self._in_think = False
                continue

            self._append_outside_text(result, before, flush=False)
            data = data[tag_index + len(tag) :]
            self._in_think = True

        return result

    def flush(self) -> dict[str, list[Any]]:
        result: dict[str, list[Any]] = {
            "thinking": [],
            "content": [],
            "web_search": [],
        }
        if not self.enabled:
            return result

        if self._tag_partial:
            if self._in_think:
                result["thinking"].append(self._tag_partial)
            else:
                self._append_outside_text(result, self._tag_partial, flush=True)
            self._tag_partial = ""
        else:
            self._append_outside_text(result, "", flush=True)

        self._in_think = False
        self._emit_web_search_event(result)
        return result


def create_stream_compat_adapter(
    request: ChatRequest, round_number: int = 0
) -> Grok2ApiStreamAdapter | None:
    adapter = Grok2ApiStreamAdapter(request, round_number)
    if not adapter.enabled:
        return None
    return adapter


__all__ = ["Grok2ApiStreamAdapter", "create_stream_compat_adapter"]
