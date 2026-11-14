"""Central configuration. Every secret comes from the environment / backend/.env, never source."""
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mongodb_uri: str = ""
    mongodb_database: str = "archmind"

    # Embeddings. "auto" = Voyage if VOYAGE_API_KEY is set, else Gemini if GEMINI_API_KEY is set.
    # Dimensions must equal numDimensions of the Atlas vector index (scripts/create_indexes.py).
    embedding_provider: str = "auto"  # auto | voyage | gemini | local (local: offline hashing, tests only)
    voyage_api_key: str = ""
    voyage_base_url: str = "https://api.voyageai.com"  # Atlas-issued keys: https://ai.mongodb.com
    voyage_embedding_model: str = "voyage-4"
    gemini_embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 1024

    # Semantic code search: indexed files are split into chunks and embedded with a code model, then results are
    # reranked. Needs Voyage (or Gemini as a fallback embedder). Without either, code search stays keyword-only.
    code_search_enabled: bool = True
    voyage_code_model: str = "voyage-code-3"
    code_embedding_dimensions: int = 1024  # must equal numDimensions of code_vector_index
    code_vector_index_name: str = "code_vector_index"
    code_max_chunks: int = 4000  # per repository
    # First batch size in (estimated) tokens. Halved automatically whenever Voyage answers 429, so free-tier keys
    # (3 requests / 10K tokens per minute) still finish, just slowly.
    voyage_batch_tokens: int = 60000
    rerank_enabled: bool = True
    voyage_rerank_model: str = "rerank-2.5"

    # Reasoning LLM (structured output). Fallbacks are tried on overload (503), rate limit (429) or unknown model (404).
    gemini_api_key: str = ""
    llm_provider: str = "gemini"
    llm_model: str = "gemini-3.5-flash-lite"
    llm_temperature: float = 0.0
    llm_fallback_models: str = "gemini-3.5-flash,gemini-3.8-flash,gemini-3.6-flash"
    llm_timeout_ms: int = 45000

    # "atlas" uses $vectorSearch. "local" is an exact cosine scan used ONLY by unit tests
    # (mongomock has no $vectorSearch). Both paths share the same governance filter.
    vector_backend: str = "atlas"
    vector_index_name: str = "memory_vector_index"

    # Signs session cookies and derives the key that encrypts stored integration tokens.
    session_secret: str = "dev-only-change-me"
    encryption_key: str = ""  # optional Fernet key; derived from session_secret when empty
    frontend_origin: str = "http://localhost:3000"

    @field_validator("frontend_origin")
    @classmethod
    def _origin_has_scheme(cls, v: str) -> str:
        """Render hands over a bare hostname (archmind-web.onrender.com); public origins are https."""
        v = v.strip().rstrip("/")
        return v if "://" in v else f"https://{v}"
    session_max_age_days: int = 7

    # GitHub OAuth app (https://github.com/settings/developers). Callback: <frontend_origin>/api/auth/github/callback
    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = ""  # defaults to <frontend_origin>/api/auth/github/callback

    # Indexing limits
    index_max_files: int = 2500
    index_max_file_bytes: int = 200_000
    index_max_archive_mb: int = 150

    memory_top_k: int = 5
    # Atlas cosine score is (1+cos)/2, so unrelated text still scores ~0.75-0.78 with Gemini embeddings; relevant memories land ~0.82+.
    memory_min_score: float = 0.80
    default_memory_ttl_days: int = 180

    @property
    def github_oauth_configured(self) -> bool:
        return bool(self.github_client_id and self.github_client_secret)

    @property
    def github_callback(self) -> str:
        return self.github_redirect_uri or f"{self.frontend_origin.rstrip('/')}/api/auth/github/callback"

    @property
    def cookie_secure(self) -> bool:
        return self.frontend_origin.startswith("https://")


@lru_cache
def get_settings() -> Settings:
    return Settings()
