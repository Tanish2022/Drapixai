from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Mapping

from drapixai_ai.configs.settings import settings


_SENSITIVE_KEY = re.compile(
    r"(^|_)(authorization|cookie|set_cookie|secret|token|password|pass|private_key|access_key|api_key)(_|$)|base64",
    re.IGNORECASE,
)
_TEXT_REDACTIONS = (
    (re.compile(r"\bBearer\s+[A-Za-z0-9._~+\/-]+=*", re.IGNORECASE), "Bearer [redacted]"),
    (re.compile(r"\b(?:dpx(?:st|sf|pv|api)?_[A-Za-z0-9_-]{12,})\b"), "[redacted-api-key]"),
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE), "[redacted-email]"),
    (re.compile(r"(cookie|set-cookie)(\s*:\s*)[^\r\n]+", re.IGNORECASE), r"\1\2[redacted]"),
    (
        re.compile(
            r'(\"?(?:person|cloth|image)_image_base64\"?\s*[:=]\s*\"?)[A-Za-z0-9+/=]{32,}',
            re.IGNORECASE,
        ),
        r"\1[redacted]",
    ),
    (
        re.compile(r"data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+", re.IGNORECASE),
        "data:image/[redacted]",
    ),
    (
        re.compile(r"\b(?:postgresql|postgres|redis|smtp|https?)://[^\s]+", re.IGNORECASE),
        "[redacted-url]",
    ),
    (
        re.compile(
            r"([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASS|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*=)([^\s]+)",
            re.IGNORECASE,
        ),
        r"\1[redacted]",
    ),
    (re.compile(r"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{256,}={0,2}(?![A-Za-z0-9+/=])"), "[redacted-base64]"),
)


def redact_sensitive(value: Any, *, key: str | None = None) -> Any:
    """Return a JSON-safe value with credentials and shopper media removed."""
    if key and _SENSITIVE_KEY.search(key):
        return "[redacted]"
    if isinstance(value, str):
        redacted = value
        for pattern, replacement in _TEXT_REDACTIONS:
            redacted = pattern.sub(replacement, redacted)
        return redacted
    if isinstance(value, Mapping):
        return {str(item_key): redact_sensitive(item_value, key=str(item_key)) for item_key, item_value in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [redact_sensitive(item) for item in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact_sensitive(str(value))


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_sensitive(record.getMessage()),
        }
        reserved = {
            "name",
            "msg",
            "args",
            "levelname",
            "levelno",
            "pathname",
            "filename",
            "module",
            "exc_info",
            "exc_text",
            "stack_info",
            "lineno",
            "funcName",
            "created",
            "msecs",
            "relativeCreated",
            "thread",
            "threadName",
            "processName",
            "process",
        }
        for key, value in record.__dict__.items():
            if key not in reserved and key not in payload:
                payload[key] = redact_sensitive(value, key=key)
        if record.exc_info:
            payload["exc_info"] = redact_sensitive(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=True)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(settings.log_level.upper())
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.propagate = False
    return logger
