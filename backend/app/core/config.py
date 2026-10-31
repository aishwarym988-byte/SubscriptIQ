from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SubscriptIQ API"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite:///./subscriptiq.db"
    jwt_secret_key: str = "local-development-only-change-this-secret-before-deploying"
    access_token_minutes: int = 60
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
