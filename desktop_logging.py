import logging
import sys
from datetime import datetime

from runtime_paths import desktop_logs_dir


DESKTOP_LOG_RETENTION_DAYS = 7
DESKTOP_LOG_STREAM = None


def _cleanup_old_desktop_logs(log_dir, retention_days: int = DESKTOP_LOG_RETENTION_DAYS) -> None:
    cutoff_ts = datetime.now().timestamp() - max(1, retention_days) * 24 * 60 * 60
    for path in log_dir.glob("backend-*.log"):
        try:
            if path.stat().st_mtime < cutoff_ts:
                path.unlink()
        except OSError:
            continue


def _desktop_log_path():
    log_dir = desktop_logs_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    _cleanup_old_desktop_logs(log_dir)
    return log_dir / f"backend-{datetime.now().strftime('%Y-%m-%d')}.log"


def init_desktop_release_logging(is_release_mode: bool) -> None:
    global DESKTOP_LOG_STREAM

    if not is_release_mode or DESKTOP_LOG_STREAM is not None:
        return

    log_path = _desktop_log_path()
    log_stream = open(log_path, "a", encoding="utf-8", buffering=1)
    DESKTOP_LOG_STREAM = log_stream
    sys.stdout = log_stream
    sys.stderr = log_stream

    def _handle_unhandled_exception(exc_type, exc_value, exc_traceback):
        if issubclass(exc_type, KeyboardInterrupt):
            return sys.__excepthook__(exc_type, exc_value, exc_traceback)
        print("未捕获异常:", file=log_stream)
        logging.getLogger("prism.desktop").exception(
            "Unhandled exception",
            exc_info=(exc_type, exc_value, exc_traceback),
        )

    sys.excepthook = _handle_unhandled_exception
    logging.basicConfig(
        level=logging.INFO,
        stream=log_stream,
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
        force=True,
    )
    logging.getLogger("prism.desktop").info("Desktop backend logging initialized: %s", log_path)

