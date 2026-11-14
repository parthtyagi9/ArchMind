# ArchMind

**Select any code and ask why it exists. ArchMind answers from your repository, tickets, docs and governed organizational memory.**

Built during the MongoDB *Agents in Context* Toronto Hackathon (Nov 14, 2026) for the *Memory You Can Govern* problem statement.

ArchMind is an IDE-style workspace for engineering teams. Connect a GitHub repository and ask a question, or select code and click **Why does this exist?**. An orchestrator runs **GitHub, Jira, Confluence and Memory sub-agents** in parallel, then a reasoning agent (Gemini) turns their evidence into a structured, validated answer.

Organizational memory (architecture decisions, bug resolutions, conventions, ownership, workarounds) lives in **MongoDB Atlas** and is retrieved with **Atlas Vector Search** under governance rules enforced inside the query.

## How it answers the brief

| Question from the brief | How ArchMind answers it |
|---|---|
| **Who can read each memory?** | The organization comes from a signed session, never the request. `tenant`, `status`, `expiry` and `scope` (org / repo / team) are filters **inside** `$vectorSearch` (`app/memory/retrieval.py`), so other organizations', other teams', expired and inactive memories are never candidates for the model. Roles: owner, admin, member. |
| **How long does a memory exist?** | Every memory can carry an expiry (30 / 90 / 365 days or never). Expired memories are excluded at query time; no cleanup job is relied on. |
| **How is memory corrected or forgotten?** | `app/memory/governance.py`. Members' and agents' proposals stay **pending** until an admin approves them. **Correct** creates a new version with a fresh embedding and supersedes the old one. **Revoke** removes it from retrieval immediately but keeps it for audit. **Purge** deletes content and embedding for every version and keeps a tombstone. Every action is in an append-only audit log that never stores memory text. |
| **Does memory change agent decisions?** | **Memory Impact** runs the same question with the same evidence and model twice, with memory removed from one arm, and shows whether the decision changed and which memories caused it. The reasoning output is sanitized so every cited memory and evidence reference was actually retrieved. |

## What is real and what is not

| Real | Not real / limited |
|---|---|
| MongoDB Atlas (hackathon sandbox) storage, Atlas Vector Search, indexes | Demo memories are synthetic, typed in for the demo (`scripts/demo_setup.py`) |
| Voyage AI `voyage-4` embeddings (1024 dims) | Jira and Confluence findings need an Atlassian site connected under **Settings → Integrations**; without one those sub-agents return nothing |
| Gemini reasoning with structured output and automatic model fallback | GitHub sign-in (private repos) needs your own GitHub OAuth app; public repos work without it |
| Email/password accounts, organizations, invites, roles, approvals, audit log | |
| GitHub repository indexing (tarball → `source_documents` + dependency graph), blame and PR history | |

## Screens

- **Explorer and editor:** file tree, code viewer, dependency graph built by static analysis of the indexed files.
- **Assistant:** chat, plus **Why does this exist?** on any selected code. Shows each sub-agent's tool calls and findings, then the structured answer.
- **Governance:**
  - **Memory Inspector:** every memory in your scope, with type, status, authority, provenance, version history and expiry. Create, correct, revoke and purge.
  - **Approval Center:** pending proposals from members and agents.
  - **Decision History:** append-only audit trail.
  - **Agent Run Inspector:** what each agent did, what memory was retrieved or withheld, and the structured decision.
  - **Memory Impact:** the with/without-memory comparison.

## Run it locally

Prereqs: Python 3.11+, [uv](https://docs.astral.sh/uv/), Node 20+. Add your IP under Atlas → Network Access.

```bash
# backend
cd backend
cp .env.example .env     # MONGODB_URI, SESSION_SECRET, GEMINI_API_KEY, VOYAGE_API_KEY (+ optional GITHUB_CLIENT_ID/SECRET)
uv sync
uv run python -m scripts.create_indexes          # collections, validators, indexes and the Atlas vector index
uv run uvicorn app.main:app --reload --port 8000 # check: curl localhost:8000/api/health

# frontend (second terminal)
cd frontend
npm install
npm run dev              # http://localhost:3000, proxies /api to :8000
```

Open http://localhost:3000, create an account (you become the owner of a new organization), then connect a repository such as `apache/kafka`.

### Demo data (optional)

With the backend running:

```bash
cd backend
uv run python -m scripts.demo_setup
# or seed your existing owner account instead of creating "Alice":
OWNER_EMAIL=you@example.com OWNER_PASSWORD=... uv run python -m scripts.demo_setup
```

This creates demo accounts across two organizations (an owner, a member on the `payments` team via invite, and a second organization for isolation tests). It connects `apache/kafka` and creates six governed memories:
- two that change answers
- one team-scoped
- one expiring
- one to correct
- one to revoke

It also adds a pending proposal. Generated passwords are written to `demo-accounts.txt` in the repo root, which git ignores.

### GitHub sign-in (optional, for private repositories)

Create an OAuth app at https://github.com/settings/developers with:

- **Homepage URL:** `http://localhost:3000`
- **Authorization callback URL:** `http://localhost:3000/api/auth/github/callback`

Then put `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `backend/.env` and restart the backend.

## Tests

```bash
cd backend
uv run pytest            # 56 unit tests, no network: auth, graph, Atlassian client, pipeline, memory governance
```

## Repository layout

```
backend/app/
  main.py               FastAPI app, /api/health, startup recovery of interrupted runs
  api/                  auth · org (members, invites) · integrations · repos · memories · agent
  agents/pipeline.py    orchestrator, GitHub/Jira/Confluence/Memory sub-agents, reasoning + sanitization, compare
  agents/llm.py         Gemini structured output with model fallback
  memory/               repository (versions) · retrieval ($vectorSearch + governance filter) · governance · embeddings
  integrations/         GitHub (archive, blame, PRs) · Atlassian (Jira JQL, Confluence CQL)
  services/             accounts · repos (indexing) · provenance · integrations (encrypted tokens) · GitHub OAuth
  code.py               static analysis: languages, imports, component dependency graph
  security.py           password hashing, signed session cookies, encryption of stored integration tokens
backend/scripts/        create_indexes.py · demo_setup.py
frontend/               Next.js 16 + Tailwind 4 (IDE workspace, governance views, settings)
```

The `docs/` folder and `setup.sh` date from an earlier prototype of this project (RecallOps) and do not describe the current app.

## Security notes

- Secrets live only in `backend/.env`, which git ignores.
- Integration tokens (Jira, Confluence, GitHub) are encrypted at rest, with a key derived from `SESSION_SECRET` or from an explicit `ENCRYPTION_KEY`.
- Passwords are hashed with scrypt, and sessions are signed httpOnly cookies.
- Purge removes memory content and embeddings from the live database. Atlas backups taken before a purge may still contain the data.
