from .anthropic import AnthropicAdapter
from .gemini import GeminiAdapter
from .openai import OpenAIAdapter


_ADAPTERS = {
    "openai": OpenAIAdapter(),
    "anthropic": AnthropicAdapter(),
    "gemini": GeminiAdapter(),
}


def get_provider_mode(provider: str) -> str:
    normalized = str(provider or "openai").strip().lower()
    if normalized == "gemini":
        return "gemini"
    if normalized == "anthropic":
        return "anthropic"
    return "openai"


def get_provider_adapter(provider: str):
    return _ADAPTERS[get_provider_mode(provider)]


def is_grok_proxy(api_url: str | None, model: str | None = None) -> bool:
    normalized_url = str(api_url or "").strip().lower()
    normalized_model = str(model or "").strip().lower()
    return (
        "grok2api" in normalized_url
        or "grok.com" in normalized_url
        or (
            normalized_model.startswith("grok-")
            and normalized_url
            and "x.ai" not in normalized_url
        )
    )
