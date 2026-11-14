"""Embedding providers and the reranker.

- Memories: Voyage AI (voyage-4) or Gemini (gemini-embedding-001) at `embedding_dimensions` (memory_vector_index).
- Code: Voyage AI voyage-code-3 (or Gemini as a fallback) at `code_embedding_dimensions` (code_vector_index).
- Rerank: Voyage rerank-2.5 re-orders retrieved candidates by relevance to the question. Without a Voyage key there is
  no reranker and results keep their vector order.

Voyage calls are batched (many texts per request). Batches shrink automatically on 429 so free-tier keys
(3 requests/min, 10K tokens/min) still complete. HashEmbedder is a deterministic bag-of-words stand-in used only by unit
tests, which cannot reach the network."""
from __future__ import annotations

import hashlib
import logging
import math
import re
import time
from typing import Callable, Protocol

from app.config import get_settings

log = logging.getLogger("archmind.embeddings")
MAX_BATCH_ITEMS = 128
MAX_RATE_LIMIT_WAITS = 30


class Embedder(Protocol):
    dimensions: int
    model: str

    def embed(self, text: str, *, kind: str = "document") -> list[float]: ...

    def embed_many(self, texts: list[str], *, kind: str = "document", progress: Callable[[int], None] | None = None) -> list[list[float]]: ...


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 3)  # code tokenizes densely; err on the high side


class GeminiEmbedder:
    def __init__(self, dimensions: int | None = None) -> None:
        from google import genai

        s = get_settings()
        if not s.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        self._client = genai.Client(api_key=s.gemini_api_key)
        self.model = s.gemini_embedding_model
        self.dimensions = dimensions or s.embedding_dimensions

    def embed(self, text: str, *, kind: str = "document") -> list[float]:
        return self.embed_many([text], kind=kind)[0]

    def embed_many(self, texts: list[str], *, kind: str = "document", progress: Callable[[int], None] | None = None) -> list[list[float]]:
        from google.genai import types

        task = "RETRIEVAL_DOCUMENT" if kind == "document" else "RETRIEVAL_QUERY"
        out: list[list[float]] = []
        for i in range(0, len(texts), 64):
            part = texts[i:i + 64]
            res = self._client.models.embed_content(model=self.model, contents=part,
                                                    config=types.EmbedContentConfig(output_dimensionality=self.dimensions, task_type=task))
            for e in res.embeddings:
                vec = list(e.values)
                if len(vec) != self.dimensions:
                    raise RuntimeError(f"Embedding has {len(vec)} dims, index expects {self.dimensions}")
                out.append(_normalize(vec))  # truncated gemini-embedding-001 vectors are not unit-length
            if progress:
                progress(len(out))
        return out


class VoyageClient:
    """Shared HTTP plumbing for Voyage embeddings and rerank (voyageai.com keys or Atlas-issued keys via ai.mongodb.com)."""

    def __init__(self) -> None:
        import httpx

        s = get_settings()
        if not s.voyage_api_key:
            raise RuntimeError("VOYAGE_API_KEY is not set")
        self._base = s.voyage_base_url.rstrip("/")
        self._http = httpx.Client(timeout=60, headers={"Authorization": f"Bearer {s.voyage_api_key}"})
        self.sleep = time.sleep  # tests replace this

    def post(self, path: str, body: dict) -> tuple[int, dict | str]:
        """Returns (status, json-or-text). Retries 5xx a few times; 429 is returned to the caller, which decides."""
        last = ""
        for attempt in range(4):
            r = self._http.post(self._base + path, json=body)
            if r.status_code in (500, 502, 503, 504):
                last = r.text[:200]
                self.sleep(2 * (attempt + 1))
                continue
            if r.status_code >= 400:
                return r.status_code, r.text[:300]
            return r.status_code, r.json()
        return 503, last


class VoyageEmbedder:
    def __init__(self, model: str | None = None, dimensions: int | None = None, client: VoyageClient | None = None) -> None:
        s = get_settings()
        self.model = model or s.voyage_embedding_model
        self.dimensions = dimensions or s.embedding_dimensions
        self.client = client or VoyageClient()
        self.batch_tokens = s.voyage_batch_tokens  # adapts downward on 429 and stays there for this process

    def embed(self, text: str, *, kind: str = "document") -> list[float]:
        return self.embed_many([text], kind=kind)[0]

    def _request(self, texts: list[str], kind: str) -> tuple[int, list[list[float]] | str]:
        body = {"input": texts, "model": self.model, "input_type": "document" if kind == "document" else "query", "output_dimension": self.dimensions}
        status, data = self.client.post("/v1/embeddings", body)
        if status != 200 or not isinstance(data, dict):
            return status, str(data)
        vecs = [d["embedding"] for d in sorted(data["data"], key=lambda d: d["index"])]
        for v in vecs:
            if len(v) != self.dimensions:
                raise RuntimeError(f"Embedding has {len(v)} dims, index expects {self.dimensions}")
        return 200, [_normalize(v) for v in vecs]

    def embed_many(self, texts: list[str], *, kind: str = "document", progress: Callable[[int], None] | None = None) -> list[list[float]]:
        out: list[list[float]] = []
        i, waits = 0, 0
        while i < len(texts):
            # take as many texts as fit the current token budget (at least one)
            j, budget = i, 0
            while j < len(texts) and j - i < MAX_BATCH_ITEMS:
                t = estimate_tokens(texts[j])
                if j > i and budget + t > self.batch_tokens:
                    break
                budget += t
                j += 1
            status, data = self._request(texts[i:j], kind)
            if status == 429:
                waits += 1
                if waits > MAX_RATE_LIMIT_WAITS:
                    raise RuntimeError("Voyage rate limit: gave up after repeated 429 responses")
                if j - i > 1:
                    self.batch_tokens = max(256, budget // 2)  # smaller requests fit a tokens-per-minute limit
                log.warning("Voyage 429; batch budget now ~%d tokens, waiting 21s", self.batch_tokens)
                self.client.sleep(21)  # free tier: 3 requests per minute
                continue
            if status != 200:
                raise RuntimeError(f"Voyage API {status}: {data}")
            out += data  # type: ignore[arg-type]
            i, waits = j, 0
            if progress:
                progress(len(out))
        return out


class VoyageReranker:
    def __init__(self, client: VoyageClient | None = None) -> None:
        self.model = get_settings().voyage_rerank_model
        self.client = client or VoyageClient()

    def rerank(self, query: str, documents: list[str], top_k: int) -> list[tuple[int, float]]:
        """[(index into documents, relevance score)] best first. Raises on failure; callers keep their own order then."""
        if not documents:
            return []
        body = {"query": query[:4000], "documents": [d[:6000] for d in documents], "model": self.model, "top_k": min(top_k, len(documents))}
        for _ in range(3):
            status, data = self.client.post("/v1/rerank", body)
            if status == 429:
                self.client.sleep(21)
                continue
            if status != 200 or not isinstance(data, dict):
                raise RuntimeError(f"Voyage rerank {status}: {data}")
            return [(d["index"], float(d["relevance_score"])) for d in data["data"]]
        raise RuntimeError("Voyage rerank rate limited")


class HashEmbedder:
    """Test-only. Similar wording -> overlapping tokens -> higher cosine. Not semantic."""

    model = "hash"

    def __init__(self, dimensions: int = 768) -> None:
        self.dimensions = dimensions

    def embed(self, text: str, *, kind: str = "document") -> list[float]:
        v = [0.0] * self.dimensions
        for tok in re.findall(r"[a-z0-9:]+", text.lower()):
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            v[h % self.dimensions] += 1.0
        return _normalize(v)

    def embed_many(self, texts: list[str], *, kind: str = "document", progress: Callable[[int], None] | None = None) -> list[list[float]]:
        out = [self.embed(t, kind=kind) for t in texts]
        if progress:
            progress(len(out))
        return out


# ------------------------------------------------------------------ singletons (tests inject their own)
_UNSET = object()
_embedder: Embedder | None = None
_code_embedder = _UNSET
_reranker = _UNSET


def set_embedder(e: Embedder | None) -> None:
    global _embedder
    _embedder = e


def set_code_embedder(e) -> None:
    """None disables semantic code search."""
    global _code_embedder
    _code_embedder = e


def set_reranker(r) -> None:
    """None disables reranking."""
    global _reranker
    _reranker = r


def reset_providers() -> None:
    global _embedder, _code_embedder, _reranker
    _embedder, _code_embedder, _reranker = None, _UNSET, _UNSET


def _provider() -> str:
    s = get_settings()
    p = s.embedding_provider
    if p == "auto":
        p = "voyage" if s.voyage_api_key else "gemini" if s.gemini_api_key else "none"
    return p


def get_embedder() -> Embedder:
    global _embedder
    if _embedder is None:
        s = get_settings()
        p = _provider()
        if p == "none":
            raise RuntimeError("No embedding provider configured: set VOYAGE_API_KEY or GEMINI_API_KEY")
        _embedder = (VoyageEmbedder() if p == "voyage" else GeminiEmbedder() if p == "gemini"
                     else HashEmbedder(s.embedding_dimensions))  # "local": offline, lexical (tests only)
    return _embedder


def get_code_embedder() -> Embedder | None:
    """voyage-code-3 when Voyage is configured, else the Gemini embedder at code dimensions, else None (keyword search only)."""
    global _code_embedder
    if _code_embedder is _UNSET:
        s = get_settings()
        p = _provider()
        if not s.code_search_enabled or p == "none":
            _code_embedder = None
        elif p == "voyage":
            _code_embedder = VoyageEmbedder(model=s.voyage_code_model, dimensions=s.code_embedding_dimensions)
        elif p == "gemini":
            _code_embedder = GeminiEmbedder(dimensions=s.code_embedding_dimensions)
        else:
            _code_embedder = HashEmbedder(s.code_embedding_dimensions)
    return _code_embedder  # type: ignore[return-value]


def get_reranker() -> VoyageReranker | None:
    global _reranker
    if _reranker is _UNSET:
        s = get_settings()
        _reranker = VoyageReranker() if (s.rerank_enabled and s.voyage_api_key) else None
    return _reranker  # type: ignore[return-value]
