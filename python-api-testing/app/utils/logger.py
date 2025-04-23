import structlog
import logging
import sys
from typing import Any

def configure_logging(level: str = "INFO") -> None:
    """Configure structured logging with structlog."""
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=level,
    )

    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
    )

def get_logger(name: str) -> Any:
    """Get a logger instance with the given name."""
    return structlog.get_logger(name) 