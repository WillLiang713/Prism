"""
工具函数实现

在这个文件中添加所有工具函数，函数名必须与 tools.json 中定义的 name 一致。
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from datetime import datetime, timezone as dt_timezone
from typing import Any
from zoneinfo import ZoneInfo
import json
import os

import httpx


_RUNTIME_CONTEXT: ContextVar[dict[str, Any]] = ContextVar(
    "tool_runtime_context",
    default={},
)


def set_runtime_context(context: dict[str, Any] | None) -> Token:
    """设置当前请求的工具运行时上下文。"""
    return _RUNTIME_CONTEXT.set(context or {})


def reset_runtime_context(token: Token) -> None:
    """重置当前请求的工具运行时上下文。"""
    _RUNTIME_CONTEXT.reset(token)


def _get_runtime_context() -> dict[str, Any]:
    return _RUNTIME_CONTEXT.get() or {}


def _normalize_max_results(value: Any, default: int = 5) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(1, min(20, number))


def _get_api_key(
    runtime: dict[str, Any],
    runtime_key: str,
    env_key: str,
) -> str:
    return (runtime.get(runtime_key) or os.getenv(env_key, "")).strip()


def _normalize_result_item(item: dict[str, Any]) -> dict[str, str]:
    return {
        "title": str(item.get("title", "") or ""),
        "url": str(item.get("url", "") or ""),
        "content": str(
            item.get("content")
            or item.get("text")
            or item.get("snippet")
            or item.get("summary")
            or ""
        ),
    }


def tavily_search(
    query: str,
    search_depth: str | None = None,
    max_results: int | None = None,
    include_answer: bool = True,
    include_domains: list[str] | None = None,
    exclude_domains: list[str] | None = None,
) -> str:
    """调用 Tavily 搜索并返回 JSON 字符串。"""
    query_text = (query or "").strip()
    if not query_text:
        return json.dumps({"error": "query 不能为空"}, ensure_ascii=False)

    runtime = _get_runtime_context()
    api_key = _get_api_key(runtime, "tavily_api_key", "TAVILY_API_KEY")

    if not api_key:
        return json.dumps(
            {"error": "缺少 Tavily API Key（请在设置中填写，或配置环境变量 TAVILY_API_KEY）"},
            ensure_ascii=False,
        )

    resolved_max_results = _normalize_max_results(
        (
            max_results
            if max_results is not None
            else (
                runtime.get("web_search_max_results")
                or runtime.get("tavily_max_results")
            )
        ),
        default=5,
    )
    depth_candidate = search_depth
    if depth_candidate is None or not str(depth_candidate).strip():
        depth_candidate = runtime.get("tavily_search_depth")
    resolved_depth = "advanced" if str(depth_candidate).lower() == "advanced" else "basic"

    payload: dict[str, Any] = {
        "api_key": api_key,
        "query": query_text,
        "search_depth": resolved_depth,
        "max_results": resolved_max_results,
        "include_answer": bool(include_answer),
        "include_raw_content": False,
        "include_images": False,
    }
    if include_domains:
        payload["include_domains"] = include_domains
    if exclude_domains:
        payload["exclude_domains"] = exclude_domains

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post("https://api.tavily.com/search", json=payload)
    except Exception as e:
        return json.dumps(
            {"error": f"Tavily 请求失败: {type(e).__name__} - {str(e)}"},
            ensure_ascii=False,
        )

    if response.status_code >= 400:
        try:
            detail: Any = response.json()
        except Exception:
            detail = response.text
        return json.dumps(
            {
                "error": "Tavily API 返回错误",
                "status_code": response.status_code,
                "detail": detail,
            },
            ensure_ascii=False,
        )

    try:
        data = response.json()
    except Exception:
        return json.dumps(
            {"error": "Tavily 返回了非 JSON 响应"},
            ensure_ascii=False,
        )

    results = data.get("results", [])
    normalized_results: list[dict[str, str]] = []
    summaries: list[str] = []
    if isinstance(results, list):
        for item in results:
            if not isinstance(item, dict):
                continue
            normalized_results.append(_normalize_result_item(item))
            summary = str(item.get("summary", "") or "").strip()
            if summary:
                summaries.append(summary)

    answer = str(data.get("answer", "") or "").strip()
    if not answer and summaries:
        answer = summaries[0]

    return json.dumps(
        {
            "query": query_text,
            "answer": answer,
            "results": normalized_results,
        },
        ensure_ascii=False,
    )


def exa_search(
    query: str,
    max_results: int | None = None,
    search_type: str | None = None,
) -> str:
    """调用 Exa 搜索并返回 JSON 字符串。"""
    query_text = (query or "").strip()
    if not query_text:
        return json.dumps({"error": "query 不能为空"}, ensure_ascii=False)

    runtime = _get_runtime_context()
    api_key = _get_api_key(runtime, "exa_api_key", "EXA_API_KEY")
    if not api_key:
        return json.dumps(
            {"error": "缺少 Exa API Key（请在设置中填写，或配置环境变量 EXA_API_KEY）"},
            ensure_ascii=False,
        )

    resolved_max_results = _normalize_max_results(
        (
            max_results
            if max_results is not None
            else (
                runtime.get("web_search_max_results")
                or runtime.get("exa_max_results")
            )
        ),
        default=5,
    )

    resolved_type = str(
        search_type
        or runtime.get("exa_search_type")
        or "auto"
    ).lower()
    if resolved_type not in {"auto", "instant"}:
        resolved_type = "auto"

    payload: dict[str, Any] = {
        "query": query_text,
        "numResults": resolved_max_results,
        "type": resolved_type,
        "contents": {
            "summary": {
                "query": "提取核心结论"
            }
        },
    }
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "Authorization": f"Bearer {api_key}",
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post("https://api.exa.ai/search", json=payload, headers=headers)
    except Exception as e:
        return json.dumps(
            {"error": f"Exa 请求失败: {type(e).__name__} - {str(e)}"},
            ensure_ascii=False,
        )

    if response.status_code >= 400:
        try:
            detail: Any = response.json()
        except Exception:
            detail = response.text
        return json.dumps(
            {
                "error": "Exa API 返回错误",
                "status_code": response.status_code,
                "detail": detail,
            },
            ensure_ascii=False,
        )

    try:
        data = response.json()
    except Exception:
        return json.dumps(
            {"error": "Exa 返回了非 JSON 响应"},
            ensure_ascii=False,
        )

    results = data.get("results", [])
    normalized_results: list[dict[str, str]] = []
    if isinstance(results, list):
        for item in results:
            if not isinstance(item, dict):
                continue
            normalized_results.append(_normalize_result_item(item))

    return json.dumps(
        {
            "query": query_text,
            "answer": str(data.get("answer", "") or ""),
            "results": normalized_results,
        },
        ensure_ascii=False,
    )


def get_current_time(timezone: str | None = None) -> str:
    """获取指定时区的当前时间，默认为北京时间 (Asia/Shanghai)。"""
    tz_name = (timezone or "").strip() or "Asia/Shanghai"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        return json.dumps(
            {"error": f"无效的时区: '{tz_name}'，请使用 IANA 时区名称，如 Asia/Shanghai、America/New_York、Europe/London 等"},
            ensure_ascii=False,
        )

    now = datetime.now(tz)
    weekday_names = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]

    return json.dumps(
        {
            "timezone": tz_name,
            "datetime": now.strftime("%Y-%m-%d %H:%M:%S"),
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "weekday": weekday_names[now.weekday()],
            "utc_offset": now.strftime("%z"),
        },
        ensure_ascii=False,
    )


TOOLS = {
    "tavily_search": tavily_search,
    "exa_search": exa_search,
    "get_current_time": get_current_time,
}


def execute_tool(tool_name: str, arguments: dict | None = None) -> str:
    """
    执行工具调用。

    Args:
        tool_name: 工具名称
        arguments: 工具参数

    Returns:
        工具执行结果
    """
    if tool_name not in TOOLS:
        return f"错误：未找到工具 '{tool_name}'"

    try:
        tool_func = TOOLS[tool_name]
        result = tool_func(**(arguments or {}))
        if isinstance(result, (dict, list)):
            return json.dumps(result, ensure_ascii=False)
        return str(result)
    except Exception as e:
        return f"错误：工具执行失败 - {str(e)}"
