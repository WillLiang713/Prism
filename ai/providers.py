import json
from datetime import datetime
from urllib.parse import quote

from runtime_paths import TOOLS_JSON_PATH

from .models import ChatRequest, HistoryTurn, ImageContent


class ProviderConfig:
    """AI提供商配置"""

    DEFAULT_URLS = {
        "openai": "https://api.openai.com/v1/chat/completions",
        "anthropic": "https://api.anthropic.com/v1/messages",
        "gemini": "https://generativelanguage.googleapis.com/v1beta",
    }

    @staticmethod
    def normalize_api_url(api_url: str | None) -> str:
        """兼容仅填写域名的地址，默认补全 https://"""
        url = (api_url or "").strip()
        if not url:
            return ""
        if "://" not in url:
            url = f"https://{url}"
        return url

    @staticmethod
    def get_provider_mode(provider: str) -> str:
        """判断提供商模式"""
        provider = provider.strip().lower()
        if provider == "gemini":
            return "gemini"
        if provider == "anthropic":
            return "anthropic"
        return "openai"

    @staticmethod
    def get_api_url(
        provider: str,
        api_url: str | None,
        provider_mode: str,
        model: str | None = None,
        *,
        stream: bool = True,
    ) -> str:
        """获取API地址，自动拼接v1路径"""
        url = ProviderConfig.normalize_api_url(api_url)

        if not url:
            if provider == "custom":
                raise ValueError("选择'自定义'时必须填写 API 地址")
            if provider_mode == "gemini":
                url = ProviderConfig.DEFAULT_URLS["gemini"]
            else:
                return ProviderConfig.DEFAULT_URLS.get(
                    provider_mode, ProviderConfig.DEFAULT_URLS["openai"]
                )

        if provider_mode == "gemini":
            if not model:
                raise ValueError("Gemini 请求必须提供模型名称")
            base_url = ProviderConfig._normalize_gemini_base_url(url)
            method = "streamGenerateContent" if stream else "generateContent"
            encoded_model = quote(str(model).strip().removeprefix("models/"), safe="")
            final_url = f"{base_url}/models/{encoded_model}:{method}"
            if stream:
                final_url = f"{final_url}?alt=sse"
            return final_url

        # 移除末尾的斜杠
        url = url.rstrip("/")
        url_lower = url.lower()

        # 检查是否已经包含完整的API端点
        if "/chat/completions" not in url_lower and "/messages" not in url_lower:
            # 根据provider_mode自动拼接对应的端点
            if provider_mode == "anthropic":
                # Anthropic格式: /v1/messages
                if not url_lower.endswith("/v1"):
                    url = f"{url}/v1/messages"
                else:
                    url = f"{url}/messages"
            else:
                # OpenAI格式: /v1/chat/completions
                if not url_lower.endswith("/v1"):
                    url = f"{url}/v1/chat/completions"
                else:
                    url = f"{url}/chat/completions"

        return url

    @staticmethod
    def _normalize_gemini_base_url(url: str) -> str:
        normalized = ProviderConfig.normalize_api_url(url).rstrip("/")
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

    @staticmethod
    def build_headers(api_key: str, provider_mode: str) -> dict[str, str]:
        """构建请求头"""
        headers = {"Content-Type": "application/json"}

        if provider_mode == "gemini":
            headers["x-goog-api-key"] = api_key
        elif provider_mode == "anthropic":
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
        else:
            headers["Authorization"] = f"Bearer {api_key}"

        return headers


class MessageBuilder:
    """消息构建器"""

    DEFAULT_SYSTEM_PROMPT = """你是一个“实时信息优先”的中文助手，回答目标是：准确、及时、可核实。
请把以下时间作为本轮对话的判断基准：
- 当前日期时间：{{datetime}}
- 当前日期：{{date}}
- 当前时间：{{time}}
- 当前时间戳：{{timestamp}}

【核心原则】
1) 只要问题可能受时间影响，就先联网搜索，再回答。
2) 不凭记忆猜“最新消息”；不确定就查证。
3) 若证据不足，明确说“不确定”，不要编造。

【必须优先联网的场景】
- 用户出现“今天、现在、当前、刚刚、最新、最近、实时、截至”等词。
- 新闻动态、政策变化、价格/汇率/股价、天气、比赛结果、航班交通、软件版本更新等易变化信息。
- 任何需要“此刻仍然成立”的结论。
- 你主观把握不足（低于90%把握）时。

【联网执行规则】
1) 判定需要联网后，先调用搜索工具，再输出正式答案。
2) 重要问题至少进行两次检索（换关键词再查一次）并交叉核对。
3) 检索词尽量包含：主题 + 时间范围 + 地区/对象。
4) 若首次结果不够新或不够全，自动补搜，不要直接结束。

【回答输出规则】
1) 先给结论，再给关键依据（时间点、数字、适用条件）。
2) 明确标注“已确认信息”和“可能变化信息”。
3) 来源链接会在界面自动展示，正文中不要重复堆链接。
4) 搜索失败时，清楚说明失败原因，并给出可执行的下一步（如建议稍后重试或提供更具体关键词）。

【无需联网的场景】
- 稳定基础知识、数学推导、代码语法、通用写作润色（除非用户明确要求最新资料）。"""

    @staticmethod
    def _render_system_prompt_template(template: str, now: datetime) -> str:
        """渲染系统提示词中的模板变量。未知变量保持原样。"""
        text = str(template or "")
        replacements = {
            "{{datetime}}": now.strftime("%Y-%m-%d %H:%M:%S"),
            "{{date}}": now.strftime("%Y-%m-%d"),
            "{{time}}": now.strftime("%H:%M:%S"),
            "{{timestamp}}": str(int(now.timestamp())),
        }
        for key, value in replacements.items():
            text = text.replace(key, value)
        return text

    @staticmethod
    def _resolve_system_prompt(config_prompt: str | None, now: datetime) -> str:
        """解析系统提示词：用户自定义优先，留空则使用内置默认。"""
        custom_prompt = (config_prompt or "").strip()
        template = (
            custom_prompt if custom_prompt else MessageBuilder.DEFAULT_SYSTEM_PROMPT
        )
        return MessageBuilder._render_system_prompt_template(template, now)

    @staticmethod
    def convert_history_to_messages(
        history_turns: list[HistoryTurn], side: str, provider_mode: str
    ) -> list[dict]:
        """将历史turns转换为消息数组"""
        if not history_turns:
            return []

        messages = []

        for turn in history_turns:
            # 跳过未完成或出错的turn
            model_data = turn.models.get(side, {})
            if not model_data.get("content") or model_data.get("status") != "complete":
                continue

            # 构建用户消息
            user_content = MessageBuilder._build_user_content(
                turn.prompt, turn.images, provider_mode
            )
            if provider_mode == "gemini":
                messages.append({"role": "user", "parts": user_content})
            else:
                messages.append({"role": "user", "content": user_content})

            # 构建助手消息
            assistant_content = model_data.get("content")
            if assistant_content:
                if provider_mode == "gemini":
                    messages.append(
                        {"role": "model", "parts": [{"text": assistant_content}]}
                    )
                else:
                    messages.append(
                        {"role": "assistant", "content": assistant_content}
                    )

        return messages

    @staticmethod
    def _build_user_content(
        prompt: str, images: list[ImageContent], provider_mode: str
    ) -> str | list[dict]:
        """构建用户消息内容(支持多模态)"""
        has_images = images and len(images) > 0

        if provider_mode == "gemini":
            return MessageBuilder._build_gemini_user_content(prompt, images)

        if not has_images:
            return prompt

        # 多模态消息
        if provider_mode == "anthropic":
            content = []
            if prompt:
                content.append({"type": "text", "text": prompt})

            for img in images:
                # 解析dataUrl: data:image/png;base64,xxxxx
                parts = img.dataUrl.split(",", 1)
                if len(parts) == 2:
                    header = parts[0]  # data:image/png;base64
                    base64_data = parts[1]

                    # 提取media_type
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

        # OpenAI格式
        content = []
        if prompt:
            content.append({"type": "text", "text": prompt})

        for img in images:
            content.append({"type": "image_url", "image_url": {"url": img.dataUrl}})

        return content

    @staticmethod
    def _build_gemini_user_content(
        prompt: str, images: list[ImageContent]
    ) -> list[dict]:
        content: list[dict] = []

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

    @staticmethod
    def build_request_body(
        config: ChatRequest,
        provider_mode: str,
        current_user_content: str | list[dict],
        history_messages: list[dict],
    ) -> dict:
        """构建请求体"""
        if provider_mode == "gemini":
            return MessageBuilder._build_gemini_body(
                config, current_user_content, history_messages
            )
        if provider_mode == "anthropic":
            return MessageBuilder._build_anthropic_body(
                config, current_user_content, history_messages
            )
        else:
            return MessageBuilder._build_openai_body(
                config, current_user_content, history_messages
            )

    @staticmethod
    def _build_anthropic_body(
        config: ChatRequest,
        user_content: str | list[dict],
        history_messages: list[dict],
    ) -> dict:
        """构建Anthropic格式请求体"""
        # 合并历史消息和当前消息
        all_messages = [*history_messages, {"role": "user", "content": user_content}]

        body = {
            "model": config.model,
            "messages": all_messages,
            "stream": True,
            "max_tokens": 4096,
        }

        # 系统提示词（用户自定义优先；留空时使用内置默认；支持模板变量替换）
        now = datetime.now()
        system_text = MessageBuilder._resolve_system_prompt(config.systemPrompt, now)
        if system_text:
            body["system"] = system_text

        tools = MessageBuilder._load_selected_tools(config)
        if tools:
            body["tools"] = MessageBuilder._convert_tools_to_anthropic(tools)

        # 思考模式
        if config.reasoningEffort and config.reasoningEffort != "none":
            budget_map = {
                "minimal": 512,
                "low": 1024,
                "medium": 2048,
                "high": 4096,
                "xhigh": 8192,
            }
            body["thinking"] = {
                "type": "enabled",
                "budget_tokens": budget_map.get(config.reasoningEffort, 2048),
            }

        return body

    @staticmethod
    def _build_openai_body(
        config: ChatRequest,
        user_content: str | list[dict],
        history_messages: list[dict],
    ) -> dict:
        """构建OpenAI格式请求体"""
        messages = []

        # 系统提示词（用户自定义优先；留空时使用内置默认；支持模板变量替换）
        now = datetime.now()
        system_text = MessageBuilder._resolve_system_prompt(config.systemPrompt, now)
        if system_text:
            messages.append({"role": "system", "content": system_text})

        # 历史消息
        messages.extend(history_messages)

        # 当前用户消息
        messages.append({"role": "user", "content": user_content})

        body = {
            "model": config.model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }

        # 添加工具定义
        tools = MessageBuilder._load_selected_tools(config)
        if tools:
            body["tools"] = tools

        # 思考模式
        if config.reasoningEffort and config.reasoningEffort != "none":
            body["reasoning_effort"] = config.reasoningEffort

        return body

    @staticmethod
    def _build_gemini_body(
        config: ChatRequest,
        user_content: list[dict],
        history_messages: list[dict],
    ) -> dict:
        body: dict = {
            "contents": [*history_messages, {"role": "user", "parts": user_content}],
        }

        now = datetime.now()
        system_text = MessageBuilder._resolve_system_prompt(config.systemPrompt, now)
        if system_text:
            body["system_instruction"] = {"parts": [{"text": system_text}]}

        tools = MessageBuilder._build_gemini_tools(config)
        if tools:
            body["tools"] = tools

        has_custom_function_tools = any(
            isinstance(tool, dict) and isinstance(tool.get("function_declarations"), list)
            for tool in tools
        )
        if config.enableTools and has_custom_function_tools:
            body["tool_config"] = {
                "function_calling_config": {
                    "mode": "auto",
                }
            }

        thinking_budget = MessageBuilder._map_reasoning_effort_to_gemini_budget(
            config.reasoningEffort
        )
        if thinking_budget is not None:
            body["generationConfig"] = {
                "thinkingConfig": {
                    "thinkingBudget": thinking_budget,
                    "includeThoughts": True,
                }
            }

        return body

    @staticmethod
    def _load_selected_tools(config: ChatRequest) -> list[dict]:
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

    @staticmethod
    def _build_gemini_tools(config: ChatRequest) -> list[dict]:
        tools: list[dict] = []

        if config.enableGoogleSearch:
            tools.append({"google_search": {}})

        if config.enableCodeExecution:
            tools.append({"code_execution": {}})

        # Gemini 当前原生工具与 function calling 不能在这个 REST 工作流里混用，
        # 因此开启原生工具时，不再附带自定义函数工具。
        if not tools:
            selected_tools = MessageBuilder._load_selected_tools(config)
            if selected_tools:
                converted = MessageBuilder._convert_tools_to_gemini(selected_tools)
                if converted:
                    tools.extend(converted)

        return tools

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    def _map_reasoning_effort_to_gemini_budget(reasoning_effort: str | None) -> int | None:
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
