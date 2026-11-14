"""LLM access with structured (schema-validated) outputs. The agent never receives free text it acts on:
every decision is parsed into a Pydantic model, then checked again by the deterministic policy layer."""
from __future__ import annotations

import logging
import time

import httpx
from typing import Literal, Optional, Protocol, TypeVar

from pydantic import BaseModel, Field, ValidationError

from app.config import get_settings

log = logging.getLogger("recallops.llm")
T = TypeVar("T", bound=BaseModel)

FailureCategory = Literal["secret_access_denied", "network", "kms", "application_bug", "capacity", "unknown"]


class Classification(BaseModel):
    failure_category: FailureCategory
    affected_service: str
    summary: str = Field(description="One-sentence neutral summary of the failure")
    search_query: str = Field(description="Short description to search historical incident memory with")


class PlanDecision(BaseModel):
    decision: Literal["call_tool", "escalate"]
    tool_name: Optional[str] = Field(None, description="Exact tool name from the catalog when decision=call_tool")
    service: Optional[str] = None
    hypothesis: str = Field(description="Current best explanation of the root cause")
    rationale: str = Field(description="Why this next action, citing evidence")
    memory_ids_used: list[str] = Field(default_factory=list,
                                       description="memory_id values of retrieved memories that influenced this decision")


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
        if get_settings().llm_provider == "rules":
            from app.agents.rules_llm import RuleBasedLLM
            _llm = RuleBasedLLM()
        else:
            _llm = GeminiLLM()
    return _llm
