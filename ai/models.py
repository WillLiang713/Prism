from typing import Any, Literal

from pydantic import BaseModel, Field


class ImageContent(BaseModel):
    """图片内容"""

    id: str
    dataUrl: str
    name: str
    size: int
    type: str | None = None


class HistoryTurn(BaseModel):
    """历史对话轮次"""

    prompt: str
    images: list[ImageContent] = []
    models: dict[str, Any] = {}


class ChatRequest(BaseModel):
    """AI聊天请求"""

    # 提供商配置
    provider: str = Field(default="openai")
    apiKey: str | None = None
    model: str | None = None
    apiUrl: str | None = None

    # 消息内容
    prompt: str
    images: list[ImageContent] = []
    systemPrompt: str | None = None
    endpointMode: Literal["chat_completions", "responses"] = "chat_completions"

    # 推理与工具
    reasoningEffort: str = "medium"
    enableTools: bool = False  # 是否启用工具调用
    enableGoogleSearch: bool = False  # 是否启用 Gemini 内置 Google Search
    maxToolRounds: int | None = Field(
        default=None, ge=1
    )  # 最大工具调用轮数；留空表示不限制
    selectedTools: list[str] = []  # 选中的工具名称列表

    # 联网相关
    webSearchProvider: str = Field(default="tavily")  # 联网服务提供方（tavily|exa）
    enableBuiltinWebSearch: bool = False  # Responses 模式下是否启用 OpenAI 内置网页搜索
    webSearchMaxResults: int | None = Field(
        default=None, ge=1, le=20
    )  # 联网默认结果数量
    tavilyApiKey: str | None = None  # Tavily Key（可选，优先于环境变量）
    exaApiKey: str | None = None  # Exa Key（可选，优先于环境变量）
    exaSearchType: str = Field(
        default="auto"
    )  # Exa 搜索模式（neural|fast|auto|deep|deep-reasoning|deep-max|instant）
    tavilyMaxResults: int = Field(default=5, ge=1, le=20)  # Tavily 默认结果数量
    tavilySearchDepth: str = Field(
        default="basic"
    )  # Tavily 默认搜索深度（basic|advanced）

    # 历史输入（后端直接使用，不再受开关控制）
    historyTurns: list[HistoryTurn] = []


class StreamChunk(BaseModel):
    """流式响应块"""

    type: Literal[
        "thinking",
        "content",
        "tokens",
        "error",
        "tool",
        "sources",
        "web_search",
    ]
    data: Any
