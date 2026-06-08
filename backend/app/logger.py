"""Centralized logging configuration using Loguru.

This module configures Loguru as the primary logger and intercepts
standard library logging to route through Loguru.

Usage:
    from app.logger import logger
    
    logger.info("Application started")
    logger.debug("Debug information")
    logger.error("Error occurred")
"""

import logging
import sys
from pathlib import Path

from loguru import logger

from app.config import get_settings

settings = get_settings()

# Track if logging has been set up to avoid duplicate configuration
_logging_configured = False


class InterceptHandler(logging.Handler):
    """
    Intercept standard library logging and redirect to Loguru.
    
    This allows third-party libraries (FastAPI, SQLAlchemy, Uvicorn, etc.)
    that use standard logging to automatically route through Loguru.
    """

    def emit(self, record: logging.LogRecord) -> None:
        """Emit a log record through Loguru."""
        # Get corresponding Loguru level if it exists
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Find caller from where originated the logged message
        frame, depth = sys._getframe(6), 6
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def setup_logging() -> None:
    """
    Set up application-wide logging configuration using Loguru.
    
    Configures:
    - Log format: Simple or JSON based on LOG_FORMAT env var
    - Log level: Based on DEBUG and LOG_LEVEL environment variables
    - Output: stdout for all logs
    - Intercepts standard library logging for third-party libraries
    
    Environment Variables:
        DEBUG: If 'true', sets log level to DEBUG (default: INFO)
        LOG_LEVEL: Explicit log level override (DEBUG|INFO|WARNING|ERROR)
        LOG_FORMAT: Output format - 'simple' or 'json' (default: simple)
    """
    global _logging_configured
    
    if _logging_configured:
        return  # Already configured, don't run again
    
    # Remove default Loguru handler
    logger.remove()
    
    # Determine log level
    # 1. If LOG_LEVEL env var is set, use it
    # 2. Otherwise, use DEBUG if DEBUG=true, else INFO
    if settings.log_level != "INFO":
        # LOG_LEVEL was explicitly set via environment variable
        log_level = settings.log_level
    else:
        # Fall back to DEBUG setting
        log_level = "DEBUG" if settings.debug else "INFO"
    
    # Determine log format
    log_format = settings.log_format if hasattr(settings, 'log_format') else "simple"
    
    if log_format == "json":
        # JSON format for production/cloud environments (AWS CloudWatch, etc.)
        # We'll use a custom format that outputs JSON-like structure
        # This is simpler and more reliable than using serialize=True which has encoding issues on Windows
        logger.add(
            sys.stdout,
            format='<green>{{</green>"time": "{time:YYYY-MM-DD HH:mm:ss.SSS}", "level": "{level}", "location": "{name}:{function}:{line}", "message": "{message}"<green>}}</green>',
            level=log_level,
            colorize=False,
        )
    else:
        # Simple format (default) - clean, readable, AWS-compatible
        # Example: 2024-06-08 12:00:00 | INFO     | app.main:startup:42 - Application starting
        logger.add(
            sys.stdout,
            format="{time:YYYY-MM-DD HH:mm:ss} | {level:<8} | {name}:{function}:{line} - {message}",
            level=log_level,
            colorize=False,  # No colors for cloud environments
        )
    
    # Intercept standard library logging
    # This redirects logs from FastAPI, SQLAlchemy, Uvicorn, etc. to Loguru
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)
    
    # Configure specific loggers to use our interceptor
    for logger_name in ["uvicorn", "uvicorn.access", "uvicorn.error", "fastapi", "sqlalchemy.engine"]:
        logging_logger = logging.getLogger(logger_name)
        logging_logger.handlers = [InterceptHandler()]
        logging_logger.propagate = False
    
    # Mark as configured
    _logging_configured = True
    
    # Log startup message
    logger.info(f"Logging configured - Level: {log_level}, Format: {log_format}, DEBUG={settings.debug}")


# Configure logging immediately on module import
setup_logging()

# Export logger for use in other modules
__all__ = ["logger"]
