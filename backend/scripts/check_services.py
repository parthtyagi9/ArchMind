"""Pre-flight: verify MongoDB, Gemini embeddings and Gemini LLM (with fallback). Run: python -m scripts.check_services"""
import sys

from app.agents.llm import Classification, GeminiLLM
from app.db import ping
from app.memory.embeddings import GeminiEmbedder

ok = True
try:
    print("mongodb:", ping())
except Exception as e:
    ok = False
    print("mongodb: FAILED -", str(e)[:300])
try:
    print("embedding dims:", len(GeminiEmbedder().embed("hello")))
except Exception as e:
    ok = False
    print("embeddings: FAILED -", str(e)[:300])
try:
    llm = GeminiLLM()
    r = llm.structured("Classify the incident.", "payment-service AccessDeniedException reading a secret", Classification)
    print("llm ok:", r.failure_category, "via", llm.model_name)
except Exception as e:
    ok = False
    print("llm: FAILED -", str(e)[:300])
sys.exit(0 if ok else 1)
