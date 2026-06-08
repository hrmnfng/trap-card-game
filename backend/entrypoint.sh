#!/bin/sh
# Entrypoint script to dynamically set uvicorn log level based on DEBUG env var

# Set log level based on DEBUG environment variable
if [ "$DEBUG" = "true" ] || [ "$DEBUG" = "True" ] || [ "$DEBUG" = "1" ]; then
    LOG_LEVEL="debug"
else
    LOG_LEVEL="info"
fi

# Run uvicorn with the appropriate log level
# --no-access-log disables uvicorn's default access logging (we use Python's logging instead)
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --log-level "$LOG_LEVEL" --no-access-log
