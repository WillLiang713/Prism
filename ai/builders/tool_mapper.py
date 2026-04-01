import json

from runtime_paths import TOOLS_JSON_PATH

from ..models import ChatRequest


def load_selected_tools(config: ChatRequest) -> list[dict]:
    if not config.enableTools:
        return []

    try:
        with open(TOOLS_JSON_PATH, "r", encoding="utf-8") as f:
            all_tools = json.load(f)
    except Exception:
        return []

    if not isinstance(all_tools, list):
        return []

    if config.selectedTools:
        selected = set(config.selectedTools)
        return [
            tool
            for tool in all_tools
            if tool.get("function", {}).get("name") in selected
        ]

    return all_tools


def _convert_tools_to_responses(tools: list[dict]) -> list[dict[str, object]]:
    responses_tools: list[dict[str, object]] = []

    for tool in tools:
        if not isinstance(tool, dict):
            continue
        if str(tool.get("type") or "").strip() != "function":
            continue

        func = tool.get("function")
        if not isinstance(func, dict):
            continue

        name = str(func.get("name") or "").strip()
        if not name:
            continue

        parameters = func.get("parameters")
        if not isinstance(parameters, dict):
            parameters = {"type": "object", "properties": {}}

        responses_tools.append(
            {
                "type": "function",
                "name": name,
                "description": str(func.get("description") or "").strip(),
                "parameters": parameters,
            }
        )

    return responses_tools


def build_responses_tools(config: ChatRequest) -> list[dict[str, object]]:
    response_tools: list[dict[str, object]] = []

    if config.enableBuiltinWebSearch:
        response_tools.append({"type": "web_search"})

    local_tools = load_selected_tools(config)
    if local_tools:
        response_tools.extend(_convert_tools_to_responses(local_tools))

    return response_tools


def build_responses_include(config: ChatRequest) -> list[str]:
    include_fields: list[str] = []
    if config.enableBuiltinWebSearch:
        include_fields.append("web_search_call.action.sources")
    return include_fields


def _convert_tools_to_gemini(tools: list[dict]) -> list[dict]:
    function_declarations = []

    for tool in tools:
        if not isinstance(tool, dict):
            continue

        func = tool.get("function")
        if not isinstance(func, dict):
            continue

        name = str(func.get("name") or "").strip()
        if not name:
            continue

        parameters = func.get("parameters")
        if not isinstance(parameters, dict):
            parameters = {"type": "object", "properties": {}}

        function_declarations.append(
            {
                "name": name,
                "description": str(func.get("description") or "").strip(),
                "parameters": parameters,
            }
        )

    if not function_declarations:
        return []

    return [{"function_declarations": function_declarations}]


def build_gemini_tools(config: ChatRequest) -> list[dict]:
    tools: list[dict] = []

    if config.enableGoogleSearch:
        tools.append({"google_search": {}})

    if not tools:
        selected_tools = load_selected_tools(config)
        if selected_tools:
            converted = _convert_tools_to_gemini(selected_tools)
            if converted:
                tools.extend(converted)

    return tools


def _convert_tools_to_anthropic(tools: list[dict]) -> list[dict]:
    anthropic_tools = []

    for tool in tools:
        if not isinstance(tool, dict):
            continue

        func = tool.get("function")
        if not isinstance(func, dict):
            continue

        name = str(func.get("name") or "").strip()
        if not name:
            continue

        input_schema = func.get("parameters")
        if not isinstance(input_schema, dict):
            input_schema = {"type": "object", "properties": {}}

        anthropic_tools.append(
            {
                "name": name,
                "description": str(func.get("description") or "").strip(),
                "input_schema": input_schema,
            }
        )

    return anthropic_tools


def build_anthropic_tools(config: ChatRequest) -> list[dict]:
    tools: list[dict] = []

    if config.enableAnthropicWebSearch:
        tools.append(
            {
                "type": "web_search_20250305",
                "name": "web_search",
            }
        )

    selected_tools = load_selected_tools(config)
    if selected_tools:
        tools.extend(_convert_tools_to_anthropic(selected_tools))

    return tools
