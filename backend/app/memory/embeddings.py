"""Embedding providers. Production path: Voyage AI voyage-4 at 1024 dims (Gemini gemini-embedding-001 supported)
(must equal numDimensions in the Atlas vector index). HashEmbedder is a deterministic
bag-of-words stand-in used only by unit tests, which cannot reach Gemini."""
from __future__ import annotations

import hashlib
import logging
import math
import re
from typing import Protocol

from app.config import get_settings

log = logging.getLogger("recallops.embeddings")


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


class VoyageEmbedder:
    """Voyage AI embeddings over its REST API. Works with keys from voyageai.com
    (https://api.voyageai.com) and with Atlas-issued keys (VOYAGE_BASE_URL=https://ai.mongodb.com)."""

    def __init__(self) -> None:
        import httpx

        s = get_settings()
        if not s.voyage_api_key:
            raise RuntimeError("VOYAGE_API_KEY is not set")
        self.model = s.embedding_model
        self.dimensions = s.embedding_dimensions
        self._url = s.voyage_base_url.rstrip("/") + "/v1/embeddings"
        self._http = httpx.Client(timeout=30, headers={"Authorization": f"Bearer {s.voyage_api_key}"})

    def embed(self, text: str, *, kind: str = "document") -> list[float]:
        body = {"input": [text], "model": self.model, "input_type": "document" if kind == "document" else "query",
                "output_dimension": self.dimensions}
        import time

        last = None
        for attempt in range(5):
            r = self._http.post(self._url, json=body)
            if r.status_code in (429, 500, 502, 503):
                last = r.text[:200]
                # Free-tier keys are limited to 3 requests/min: wait out the window instead of failing.
                wait = 21 if r.status_code == 429 else 2 * (attempt + 1)
                log.warning("Voyage %s; retrying in %ss", r.status_code, wait)
                time.sleep(wait)
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"Voyage API {r.status_code}: {r.text[:300]}")
            vec = r.json()["data"][0]["embedding"]
            if len(vec) != self.dimensions:
                raise RuntimeError(f"Embedding has {len(vec)} dims, index expects {self.dimensions}")
            return _normalize(vec)
        raise RuntimeError(f"Voyage API unavailable: {last}")


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
        p = get_settings().embedding_provider
        _embedder = (VoyageEmbedder() if p == "voyage" else GeminiEmbedder() if p == "gemini"
                     else HashEmbedder(get_settings().embedding_dimensions))  # "local": offline, lexical
    return _embedder
