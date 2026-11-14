"""Embedding providers. Production path: Gemini gemini-embedding-001 truncated to 768 dims
(must equal numDimensions in the Atlas vector index). HashEmbedder is a deterministic
bag-of-words stand-in used only by unit tests, which cannot reach Gemini."""
from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

from app.config import get_settings


class Embedder(Protocol):
    dimensions: int

    def embed(self, text: str, *, kind: str = "document") -> list[float]: ...


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


class GeminiEmbedder:
    def __init__(self) -> None:
        from google import genai

        s = get_settings()
        if not s.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        self._client = genai.Client(api_key=s.gemini_api_key)
        self.model = s.embedding_model
        self.dimensions = s.embedding_dimensions

    def embed(self, text: str, *, kind: str = "document") -> list[float]:
        from google.genai import types

        task = "RETRIEVAL_DOCUMENT" if kind == "document" else "RETRIEVAL_QUERY"
        res = self._client.models.embed_content(
            model=self.model,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=self.dimensions, task_type=task),
        )
        vec = list(res.embeddings[0].values)
        if len(vec) != self.dimensions:
            raise RuntimeError(f"Embedding has {len(vec)} dims, index expects {self.dimensions}")
        # Truncated (<3072) gemini-embedding-001 vectors are not unit-length; normalize for cosine.
        return _normalize(vec)


class HashEmbedder:
    """Test-only. Similar wording -> overlapping tokens -> higher cosine. Not semantic."""

    def __init__(self, dimensions: int = 768) -> None:
        self.dimensions = dimensions

    def embed(self, text: str, *, kind: str = "document") -> list[float]:
        v = [0.0] * self.dimensions
        for tok in re.findall(r"[a-z0-9:]+", text.lower()):
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            v[h % self.dimensions] += 1.0
        return _normalize(v)


_embedder: Embedder | None = None


def set_embedder(e: Embedder | None) -> None:
    global _embedder
    _embedder = e


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        _embedder = GeminiEmbedder()
    return _embedder
