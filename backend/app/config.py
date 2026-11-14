"""Central configuration. Every secret comes from the environment / backend/.env, never source."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mongodb_uri: str = ""
    mongodb_database: str = "recallops"

    gemini_api_key: str = ""
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 768
    llm_model: str = "gemini-3.8-flash"
    llm_temperature: float = 0.0
    # Tried in order when the primary model is overloaded (503), rate-limited (429) or unknown (404).
    llm_fallback_models: str = "gemini-3.5-flash,gemini-2.5-flash,gemini-3.5-flash-lite"

    # "atlas" uses $vectorSearch. "local" is an exact cosine scan used ONLY by unit tests
    # (mongomock has no $vectorSearch). Both paths share the same governance filter.
    vector_backend: str = "atlas"
    vector_index_name: str = "memory_vector_index"

    # Signs the demo-session cookie. Must be overridden outside local dev.
    session_secret: str = "dev-only-change-me"
    demo_mode: bool = True
    frontend_origin: str = "http://localhost:3000"

    max_agent_steps: int = 8
    max_repair_attempts: int = 2
    memory_top_k: int = 4
    memory_min_score: float = 0.70
    default_memory_ttl_days: int = 90


@lru_cache
def get_settings() -> Settings:
    return Settings()
