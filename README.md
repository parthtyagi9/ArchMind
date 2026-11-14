# RecallOps

**The incident response agent that learns, remembers, and forgets responsibly.**
Built during the MongoDB *Agents in Context* Toronto Hackathon (Nov 14, 2026). Problem statement: *Memory You Can Govern*.

RecallOps diagnoses infrastructure incidents with a LangGraph agent, executes **allowlisted** recovery tools behind a human approval gate, **independently verifies** the result, and writes a verified memory to MongoDB Atlas. Memories are retrieved with **Atlas Vector Search pre-filtered by tenant, status and expiry**. They can be corrected (new immutable version, re-embedded), invalidated (logically forgotten) or purged (content + embedding physically removed), and every step is audited. A built-in controlled A/B experiment shows whether memory actually changed what the agent did.

| Question from the brief | Where it is answered in working software |
|---|---|
| How do we prevent memories leaking between tenants? | Tenant comes from a signed server-side session, never the request (`app/auth.py`). `tenant_id` is a filter **inside** `$vectorSearch` (`app/memory/retrieval.py`). Every read/write is tenant-scoped. Tests: `test_tenant_isolation_both_directions`, `test_tenant_in_body_or_query_is_ignored`, `test_leaked_memory_would_change_behavior_but_isolation_prevents_it`. |
| How do we correct or remove outdated memories? | `app/memory/governance.py`: correct → supersede + new version + new embedding. Invalidate → excluded immediately. Purge → content/embedding `$unset`, tombstone kept. Expiry is filtered at query time (TTL is only cleanup). |
| How do we prove a memory changed behavior? | **Memory A/B** tab / `POST /api/incidents/{id}/experiment`: same incident, tools, model, temperature and approval policy; simulator reset before each arm; neither arm writes memory. The two runs' tool sequences, retrieved memory IDs and citations are compared side by side. |

## What is real vs simulated

| Real | Simulated |
|---|---|
| MongoDB Atlas (hackathon sandbox M10), Atlas Vector Search, schema validation, indexes | AWS: IAM / Secrets Manager / KMS / VPC are a deterministic simulator whose state lives in MongoDB (`simulator_states`) |
| Gemini `gemini-embedding-001` (768-d) embeddings and Gemini LLM decisions with structured output | Identity: demo users with a signed cookie (not production auth) |
| LangGraph state machine, approval gate, independent verification, audit log | — |

## Quick start (local)

**Fastest:** `./setup.sh` from the repo root. It prompts for your Atlas URI and Gemini key (hidden input), writes `backend/.env`, checks both connections, creates indexes, seeds, and runs the unit and live tests.


Prereqs: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 20+. Add your IP in Atlas → Network Access.

```bash
# backend
cd backend
cp .env.example .env        # fill MONGODB_URI, GEMINI_API_KEY, SESSION_SECRET
uv sync
uv run python -m scripts.create_indexes   # collections, validators, indexes, vector index (waits until queryable)
uv run python -m scripts.seed_demo        # two tenants of synthetic memories + simulator state
uv run uvicorn app.main:app --reload --port 8000
# check: curl localhost:8000/api/health   -> mongodb.ok: true

# frontend (new terminal)
cd frontend
npm install
npm run dev                 # http://localhost:3000  (proxies /api to :8000)
```

Tests:
```bash
cd backend
uv run pytest                                         # 25 unit tests, no network (mongomock + scripted LLM)
RUN_LIVE=1 uv run pytest tests/integration -m integration -s   # live Atlas $vectorSearch + Gemini (uses <db>_it)
```

## Repo layout

```
backend/app/
  auth.py            demo identity (signed cookie → server-side tenant + roles)
  audit.py           append-only audit_events
  memory/            embeddings.py · repository.py (versions) · retrieval.py ($vectorSearch) · governance.py
  agents/            graph.py (LangGraph) · llm.py (Gemini structured output) · prompts.py · state.py
  simulator/         state.py (AWS-like state + independent evaluator) · tools.py (allowlisted registry)
  services/runs.py   incidents, runs, approvals, A/B experiment
  api/routes.py      FastAPI endpoints
backend/scripts/     create_indexes.py · seed_demo.py
frontend/            Next.js 16 + Tailwind 4 workspace (incident, memory inspector, A/B, audit)
docs/                architecture.md · demo-script.md · api-contracts.md · roadmap.md
```

See [docs/architecture.md](docs/architecture.md) for design decisions and known limitations.
