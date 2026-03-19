import argparse
import os
import sys
from datetime import datetime


def _parse_runtime_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--host", default=os.getenv("PRISM_HOST", "localhost"))
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("PRISM_PORT", "3000")),
    )
    parser.add_argument(
        "--desktop-mode",
        action="store_true",
        default=os.getenv("PRISM_DESKTOP_MODE", "").strip() == "1",
    )
    args, _ = parser.parse_known_args(argv)
    return args


RUNTIME_ARGS = _parse_runtime_args(sys.argv[1:])
DESKTOP_MODE = bool(RUNTIME_ARGS.desktop_mode)
DESKTOP_RELEASE_MODE = DESKTOP_MODE and bool(getattr(sys, "frozen", False))
BUILD_ID = (os.getenv("PRISM_BUILD_ID") or datetime.now().strftime("%Y%m%d%H%M%S")).strip()


def _read_env(name: str) -> str:
    return os.getenv(name, "").strip()


def normalize_web_default_provider(value: str) -> str:
    normalized = (value or "").strip().lower()
    if not normalized:
        return ""
    return "anthropic" if normalized == "anthropic" else "openai"


def normalize_web_default_endpoint_mode(value: str) -> str:
    normalized = (value or "").strip().lower()
    if not normalized:
        return ""
    return "responses" if normalized == "responses" else "chat_completions"


def get_web_model_defaults() -> dict[str, str | bool]:
    provider = normalize_web_default_provider(_read_env("PRISM_WEB_DEFAULT_PROVIDER"))
    endpoint_mode = normalize_web_default_endpoint_mode(
        _read_env("PRISM_WEB_DEFAULT_ENDPOINT_MODE")
    )
    api_url = _read_env("PRISM_WEB_DEFAULT_API_URL")
    api_key = _read_env("PRISM_WEB_DEFAULT_API_KEY")
    model = _read_env("PRISM_WEB_DEFAULT_MODEL")
    return {
        "provider": provider,
        "endpointMode": endpoint_mode,
        "apiUrl": api_url,
        "apiKey": api_key,
        "model": model,
        "hasApiKey": bool(api_key),
    }


def get_web_model_defaults_for_client() -> dict[str, str | bool]:
    defaults = get_web_model_defaults()
    return {
        "provider": str(defaults["provider"] or ""),
        "endpointMode": str(defaults["endpointMode"] or ""),
        "apiUrl": str(defaults["apiUrl"] or ""),
        "model": str(defaults["model"] or ""),
        "hasApiKey": bool(defaults["hasApiKey"]),
    }
