"""Centralized logging configuration for the application.

This module is imported very early to ensure logging is configured
before any other modules create loggers.
"""

import logging
import sys

from app.config import get_settings

settings = get_settings()

# Track if logging has been set up to avoid duplicate configuration
_logging_configured = False


def setup_logging() -> None:
    """
    Set up application-wide logging configuration.
    
    Configures:
    - Log format: [logger_name - file:line:function] LEVEL - message
    - Log level: Based on DEBUG environment variable  
    - Output: stdout for all logs
    
    Removes all existing handlers to prevent duplicates.
    """
    global _logging_configured
    
    if _logging_configured:
        return  # Already configured, don't run again
    
    # Get the root logger
    logger = logging.getLogger()

    # Remove ALL existing handlers to prevent duplicates
    handlers_to_remove = logger.handlers.copy()
    for handler in handlers_to_remove:
        logger.removeHandler(handler)

    # Determine log level:
    # 1. If LOG_LEVEL env var is set, use it
    # 2. Otherwise, use DEBUG if DEBUG=true, else INFO
    if settings.log_level != "INFO":
        # LOG_LEVEL was explicitly set via environment variable
        log_level = getattr(logging, settings.log_level, logging.INFO)
    else:
        # Fall back to DEBUG setting
        log_level = logging.DEBUG if settings.debug else logging.INFO

    # Create formatter with consistent format across all loggers
    # Format: [logger_name - filename:line:function] LEVEL - message
    # Use fixed-width level names to normalize padding for all levels.
    formatter = logging.Formatter(
        "[%(levelname)-8s] [%(pathname)s:%(lineno)d:%(funcName)s] - %(message)s"
    )

    # Create StreamHandler for console output and set the formatter
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    
    # Add our handler
    logger.addHandler(handler)

    # Set the logging level
    logger.setLevel(log_level)

    # Configure SQLAlchemy logger to use root logger's handler
    sqlalchemy_logger = logging.getLogger("sqlalchemy.engine")
    sqlalchemy_logger.propagate = True  # Use root logger's handlers
    sqlalchemy_logger.setLevel(log_level)

    # Configure uvicorn loggers to use root logger's handler
    for logger_name in ["uvicorn.access", "uvicorn.error", "uvicorn"]:
        uvicorn_logger = logging.getLogger(logger_name)
        # Remove uvicorn's default handlers to prevent duplicates
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True  # Use root logger's handlers
        uvicorn_logger.setLevel(log_level)

    # Mark as configured
    _logging_configured = True
    
    # Log startup message
    logger.info(f"Logging configured - Level: {logging.getLevelName(log_level)}, DEBUG={settings.debug}")


# Configure logging immediately on module import
setup_logging()
