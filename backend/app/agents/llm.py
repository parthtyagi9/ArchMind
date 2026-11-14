"""LLM access with structured (schema-validated) outputs. The agent never receives free text it acts on:
every decision is parsed into a Pydantic model, then checked again by the deterministic policy layer."""
from __future__ import annotations

import logging
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
        self._client = genai.Client(api_key=s.gemini_api_key)
        self.model_name = s.llm_model
        self.temperature = s.llm_temperature

    def structured(self, system: str, prompt: str, schema: type[T]) -> T:
        from google.genai import types

        cfg = types.GenerateContentConfig(system_instruction=system, temperature=self.temperature,
                                          response_mime_type="application/json", response_schema=schema)
        last: Exception | None = None
        for _ in range(2):
            resp = self._client.models.generate_content(model=self.model_name, contents=prompt, config=cfg)
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
