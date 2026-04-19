import argparse
import os
import sys
from datetime import datetime


def _parse_runtime_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--host", default=os.getenv("PRISM_HOST", "0.0.0.0"))
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
