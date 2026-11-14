"""Pre-flight: verify MongoDB, Gemini embeddings and Gemini LLM (with fallback). Run: python -m scripts.check_services"""
import sys

from app.agents.llm import Classification, get_llm
from app.db import ping
from app.config import get_settings
from app.memory.embeddings import get_embedder

ok = True
try:
    print("mongodb:", ping())
except Exception as e:
    ok = False
    print("mongodb: FAILED -", str(e)[:300])
try:
    st = get_settings()
    print(f"embedding dims ({st.embedding_provider}/{st.embedding_model}):", len(get_embedder().embed("hello")))
except Exception as e:
    ok = False
    print("embeddings: FAILED -", str(e)[:300])
try:
    llm = get_llm()
    r = llm.structured("Classify the incident.", '<untrusted_incident>{"service": "payment-service", "error_code": "AccessDeniedException"}</untrusted_incident>', Classification)
    print("llm ok:", r.failure_category, "via", llm.model_name)
except Exception as e:
    ok = False
    print("llm: FAILED -", str(e)[:300])
sys.exit(0 if ok else 1)
