"""LLM access with structured (schema-validated) outputs. The reasoning agent never returns free text the system acts
on: every answer is parsed into a Pydantic model and then sanitized against the evidence that was actually retrieved."""
from __future__ import annotations

import logging
import time

import httpx
from typing import Literal, Protocol, TypeVar

from pydantic import BaseModel, Field, ValidationError

from app.config import get_settings

log = logging.getLogger("archmind.llm")
T = TypeVar("T", bound=BaseModel)

Verdict = Literal["proceed", "proceed_with_constraints", "needs_architecture_review", "insufficient_evidence"]


class LLMConstraint(BaseModel):
    text: str = Field(description="A constraint on the recommendation that comes from an approved organizational memory")
    memory_ref: str = Field(description='The exact memory_ref (e.g. "mem_ab12@v2") of the memory that imposes it')


class LLMAnswer(BaseModel):
    headline: str = Field(description="One-line title of the finding")
    explanation: list[str] = Field(description="2-4 short paragraphs explaining why the code/system is the way it is, using only the evidence")
    verdict: Verdict = Field(description="Can the developer change this as they likely intend? See rules in the system prompt")
    recommendation: str = Field(description="Concrete guidance for someone about to change or extend this")
    constraints: list[LLMConstraint] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(description="refs of the evidence items you actually relied on")
    affected_components: list[str] = Field(default_factory=list, description="component ids from the provided list")
    confidence: Literal["low", "medium", "high"]


class LLM(Protocol):
    model_name: str

    def structured(self, system: str, prompt: str, schema: type[T]) -> T: ...


class GeminiLLM:
    def __init__(self) -> None:
        from google import genai

        s = get_settings()
        if not s.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        from google.genai import types as _t
        # Bounded request time so an overloaded model fails over instead of hanging the agent.
        self._client = genai.Client(api_key=s.gemini_api_key, http_options=_t.HttpOptions(timeout=s.llm_timeout_ms))
        self.models = [s.llm_model] + [m.strip() for m in s.llm_fallback_models.split(",") if m.strip() and m.strip() != s.llm_model]
        self.model_name = self.models[0]
        self.temperature = s.llm_temperature

    def _generate(self, prompt: str, cfg):
        """Try the primary model, then fallbacks, on overload/rate-limit (503/429/500). The model actually
        used is kept in self.model_name so runs record it."""
        from google.genai import errors

        last: Exception | None = None
        for model in self.models:
            for attempt in range(2):
                try:
                    resp = self._client.models.generate_content(model=model, contents=prompt, config=cfg)
                    self.model_name = model
                    return resp
                except (errors.ServerError, errors.ClientError, httpx.TimeoutException) as e:
                    code = getattr(e, "code", None) or (504 if isinstance(e, httpx.TimeoutException) else None)
                    if code not in (429, 500, 503, 504, 404):
                        raise
                    last = e
                    log.warning("Gemini %s on %s (attempt %d); %s", code, model, attempt + 1,
                                "trying next model" if code == 404 or attempt else "retrying")
                    if code == 404:
                        break
                    time.sleep(1.5)
        raise RuntimeError(f"All Gemini models unavailable: {last}")

    def structured(self, system: str, prompt: str, schema: type[T]) -> T:
        from google.genai import types

        cfg = types.GenerateContentConfig(system_instruction=system, temperature=self.temperature,
                                          response_mime_type="application/json", response_schema=schema)
        last: Exception | None = None
        for _ in range(2):
            resp = self._generate(prompt, cfg)
            try:
                if isinstance(getattr(resp, "parsed", None), schema):
                    return resp.parsed
                return schema.model_validate_json(resp.text)
            except (ValidationError, ValueError, TypeError) as e:
                last = e
                log.warning("LLM output failed validation, retrying: %s", e)
        raise RuntimeError(f"LLM returned invalid structured output: {last}")


_llm: LLM | None = None


def set_llm(llm: LLM | None) -> None:
    global _llm
    _llm = llm


def get_llm() -> LLM:
    global _llm
    if _llm is None:
        _llm = GeminiLLM()
    return _llm
