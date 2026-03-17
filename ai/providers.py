import json
from datetime import datetime

from runtime_paths import TOOLS_JSON_PATH

from .models import ChatRequest, HistoryTurn, ImageContent


class ProviderConfig:
    """AI提供商配置"""

    DEFAULT_URLS = {
        "openai": "https://api.openai.com/v1/chat/completions",
        "openai_responses": "https://api.openai.com/v1/responses",
        "anthropic": "https://api.anthropic.com/v1/messages",
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
        return "anthropic" if provider == "anthropic" else "openai"

    @staticmethod
    def get_api_url(
        provider: str,
        api_url: str | None,
        provider_mode: str,
        endpoint_mode: str = "chat_completions",
    ) -> str:
        """获取API地址，自动拼接v1路径"""
        url = ProviderConfig.normalize_api_url(api_url)

        if not url:
            if provider == "custom":
                raise ValueError("选择'自定义'时必须填写 API 地址")
            if provider_mode == "anthropic":
                return ProviderConfig.DEFAULT_URLS["anthropic"]
            if endpoint_mode == "responses":
                return ProviderConfig.DEFAULT_URLS["openai_responses"]
            return ProviderConfig.DEFAULT_URLS["openai"]

        # 移除末尾的斜杠
        url = url.rstrip("/")
        url_lower = url.lower()
        responses_suffix = "/responses"
        openai_suffix = "/chat/completions"
        anthropic_suffix = "/messages"
        models_suffix = "/models"

        if provider_mode == "anthropic":
            if anthropic_suffix not in url_lower:
                if url_lower.endswith("/v1"):
                    return f"{url}{anthropic_suffix}"
                return f"{url}/v1{anthropic_suffix}"
            return url

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

    @staticmethod
    def build_headers(api_key: str, provider_mode: str) -> dict[str, str]:
        """构建请求头"""
        headers = {"Content-Type": "application/json"}

        if provider_mode == "anthropic":
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
            messages.append({"role": "user", "content": user_content})

            # 构建助手消息
            assistant_content = model_data.get("content")
            if assistant_content:
                messages.append({"role": "assistant", "content": assistant_content})

        return messages

    @staticmethod
    def _build_user_content(
        prompt: str, images: list[ImageContent], provider_mode: str
    ) -> str | list[dict]:
        """构建用户消息内容(支持多模态)"""
        has_images = images and len(images) > 0

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
        else:
            # OpenAI格式
            content = []
            if prompt:
                content.append({"type": "text", "text": prompt})

            for img in images:
                content.append({"type": "image_url", "image_url": {"url": img.dataUrl}})

            return content

    @staticmethod
    def build_request_body(
        config: ChatRequest,
        provider_mode: str,
        current_user_content: str | list[dict],
        history_messages: list[dict],
        endpoint_mode: str = "chat_completions",
    ) -> dict:
        """构建请求体"""
        if endpoint_mode == "responses":
            return MessageBuilder.build_responses_request_body(
                config,
                current_user_content,
                history_messages,
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
    def build_responses_request_body(
        config: ChatRequest,
        user_content: str | list[dict],
        history_messages: list[dict],
    ) -> dict:
        """构建 OpenAI Responses API 请求体"""
        now = datetime.now()
        instructions = MessageBuilder._resolve_system_prompt(config.systemPrompt, now)

        input_items: list[dict[str, object]] = []
        for message in history_messages:
            response_message = MessageBuilder._convert_message_to_responses_input(message)
            if response_message:
                input_items.append(response_message)

        current_message = MessageBuilder._convert_message_to_responses_input(
            {"role": "user", "content": user_content}
        )
        if current_message:
            input_items.append(current_message)

        body: dict[str, object] = {
            "model": config.model,
            "input": input_items,
            "stream": True,
        }

        if instructions:
            body["instructions"] = instructions

        if config.reasoningEffort and config.reasoningEffort != "none":
            body["reasoning"] = {"effort": config.reasoningEffort}

        response_tools: list[dict[str, object]] = []
        if config.enableBuiltinWebSearch:
            response_tools.append({"type": "web_search"})
            body["include"] = ["web_search_call.action.sources"]

        local_tools = MessageBuilder._load_selected_tools(config)
        if local_tools:
            response_tools.extend(MessageBuilder._convert_tools_to_responses(local_tools))

        if response_tools:
            body["tools"] = response_tools

        return body

    @staticmethod
    def build_responses_followup_body(
        config: ChatRequest,
        previous_response_id: str,
        tool_outputs: list[dict[str, object]],
        tools: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        body: dict[str, object] = {
            "model": config.model,
            "previous_response_id": previous_response_id,
            "input": tool_outputs,
            "stream": True,
        }

        if config.reasoningEffort and config.reasoningEffort != "none":
            body["reasoning"] = {"effort": config.reasoningEffort}

        now = datetime.now()
        instructions = MessageBuilder._resolve_system_prompt(config.systemPrompt, now)
        if instructions:
            body["instructions"] = instructions

        if tools:
            body["tools"] = tools

        if config.enableBuiltinWebSearch:
            body["include"] = ["web_search_call.action.sources"]

        return body

    @staticmethod
    def _convert_message_to_responses_input(
        message: dict[str, object],
    ) -> dict[str, object] | None:
        role = str(message.get("role") or "").strip()
        if role not in {"user", "assistant"}:
            return None

        text_item_type = (
            "output_text" if role == "assistant" else "input_text"
        )

        content = message.get("content")
        if isinstance(content, str):
            text = content.strip()
            if not text:
                return None
            return {
                "role": role,
                "content": [{"type": text_item_type, "text": text}],
            }

        if not isinstance(content, list):
            return None

        response_content: list[dict[str, object]] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            item_type = str(item.get("type") or "").strip()
            if item_type in {"text", "input_text", "output_text"}:
                text = str(item.get("text") or "").strip()
                if text:
                    response_content.append(
                        {"type": text_item_type, "text": text}
                    )
            elif role == "user" and item_type in {"image_url", "input_image"}:
                image_value = item.get("image_url")
                image_url = ""
                detail = ""

                if isinstance(image_value, dict):
                    image_url = str(image_value.get("url") or "").strip()
                    detail = str(image_value.get("detail") or "").strip()
                else:
                    image_url = str(image_value or "").strip()

                if image_url:
                    image_item: dict[str, object] = {
                        "type": "input_image",
                        "image_url": image_url,
                    }
                    if detail:
                        image_item["detail"] = detail
                    response_content.append(image_item)
            elif role == "assistant" and item_type == "refusal":
                refusal = str(item.get("refusal") or item.get("text") or "").strip()
                if refusal:
                    response_content.append({"type": "refusal", "refusal": refusal})

        if not response_content:
            return None

        return {"role": role, "content": response_content}

    @staticmethod
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
