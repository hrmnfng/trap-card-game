"""Application configuration using Pydantic Settings."""

from functools import lru_cache
from typing import Literal

from pydantic import PostgresDsn, RedisDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "Trap Card Game"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False  # Set via DEBUG env var or .env file
    api_prefix: str = "/api/v1"

    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug(cls, v: bool | str) -> bool:
        """Parse debug value from environment variable.
        
        Handles string values like 'true', 'True', 'TRUE', '1' from env vars.
        """
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes", "on")
        return bool(v)
    
    # Logging
    log_level: str = "INFO"  # Can override with LOG_LEVEL env var (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    
    @field_validator("log_level", mode="before")
    @classmethod
    def parse_log_level(cls, v: str) -> str:
        """Validate and uppercase log level."""
        if isinstance(v, str):
            v = v.upper()
            if v in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
                return v
        return "INFO"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Database
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "trapcard"
    postgres_password: str = "trapcard"
    postgres_db: str = "trapcard_game"
    database_url: PostgresDsn | None = None

    @field_validator("database_url", mode="before")
    @classmethod
    def assemble_db_connection(cls, v: str | None, info: dict) -> str:
        """Build database URL from components if not provided."""
        if isinstance(v, str) and v:
            return v
        
        values = info.data
        return str(
            PostgresDsn.build(
                scheme="postgresql+asyncpg",
                username=values.get("postgres_user"),
                password=values.get("postgres_password"),
                host=values.get("postgres_host"),
                port=values.get("postgres_port"),
                path=values.get("postgres_db", ""),
            )
        )

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_password: str | None = None
    redis_url: RedisDsn | None = None

    @field_validator("redis_url", mode="before")
    @classmethod
    def assemble_redis_connection(cls, v: str | None, info: dict) -> str:
        """Build Redis URL from components if not provided."""
        if isinstance(v, str) and v:
            return v
        
        values = info.data
        password_part = f":{values.get('redis_password')}@" if values.get("redis_password") else ""
        
        return str(
            RedisDsn.build(
                scheme="redis",
                host=f"{password_part}{values.get('redis_host')}",
                port=values.get("redis_port"),
                path=f"/{values.get('redis_db', 0)}",
            )
        )

    # JWT
    jwt_secret_key: str = "your-secret-key-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expiration_minutes: int = 1440  # 24 hours

    # Game Settings
    lobby_expiration_hours: int = 24
    max_players_per_lobby: int = 10
    cards_per_player: int = 3
    min_card_value: int = 1
    max_card_value: int = 9

    # Firebase Cloud Messaging
    firebase_credentials_path: str | None = None
    fcm_enabled: bool = False

    # CORS
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ]


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
