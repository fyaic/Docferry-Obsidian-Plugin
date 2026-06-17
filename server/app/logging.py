from __future__ import annotations

import json
import logging
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in (
            "event",
            "request_id",
            "method",
            "path",
            "path_template",
            "status_code",
            "duration_ms",
            "error_type",
        ):
            if hasattr(record, key):
                value = getattr(record, key)
                if value is not None:
                    payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(log_format: str, log_level: str) -> None:
    logger = logging.getLogger("docferry")
    logger.setLevel(normalized_level(log_level))
    logger.propagate = False

    formatter: logging.Formatter
    if log_format.lower() == "json":
        formatter = JsonFormatter()
    else:
        formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")

    handler = next((item for item in logger.handlers if getattr(item, "_docferry_handler", False)), None)
    if handler is None:
        handler = logging.StreamHandler()
        setattr(handler, "_docferry_handler", True)
        logger.addHandler(handler)
    handler.setLevel(normalized_level(log_level))
    handler.setFormatter(formatter)


def normalized_level(value: str) -> int:
    return getattr(logging, value.upper(), logging.INFO)
