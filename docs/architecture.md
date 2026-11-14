# Architecture

```
Next.js workspace ──/api (same-origin rewrite)──▶ FastAPI
                                                   │  session cookie → Principal{tenant_id, roles}  (server-side)
                                                   ▼
                                          LangGraph agent run
  classify ─▶ retrieve ─▶ plan ─▶ policy ─┬▶ execute ─┬▶ (read-only) ─▶ plan
     (LLM)   ($vectorSearch) (LLM)  (code) │           └▶ verify (code, re-reads Mongo) ─┬▶ record_memory ─▶ finalize
                                           │                                            ├▶ plan (bounded retry)
                                           └▶ await_approval ─▶ END (resume via API)     └▶ finalize (failed)
                                                   │
                     MongoDB Atlas: memories (+vector index) · incidents · agent_runs · approvals
                                    simulator_states · audit_events · experiments
```

## Key decisions

**Tenant identity.** The browser holds an HMAC-signed httpOnly cookie containing only a `user_id`. Tenant and roles come from a server-side directory. Request bodies are parsed with `extra="ignore"`, so a client `tenant_id` is dropped. Lookups of foreign IDs return 404 (no existence oracle). This is demo identity, not production auth.

**Governed retrieval.** The vector index declares `tenant_id`, `status`, `expires_at` and `memory_type` as filter fields. Every query runs `$vectorSearch` with `filter: {tenant_id: $eq, status: $eq "active", expires_at: $gt now}`. Other tenants', expired, superseded, invalidated and purged vectors are therefore never candidates. An identical `$match` after the search is defence in depth. TTL is not relied on for correctness.

**Immutable versions.** `memory_id` is the lineage and each version is its own document. A partial unique index (`memory_id` where `status = "active"`) guarantees one active version per lineage. Correction marks the old version `superseded` and inserts version N+1 with a fresh embedding.

**Forgetting, precisely.**
- *Invalidate*: `status = invalidated`; excluded from retrieval immediately; content and embedding retained (reversible, auditable).
- *Purge*: for every version, `content`, `embedding`, `resolution_params` and the retrieval log are `$unset`; a tombstone keeps ids, tenant, version numbers, timestamps and a SHA-256 of the former content.
- *Audit events* never contain memory content, so purge leaves no copy in the audit log.
- *Limitation*: Atlas backups or snapshots taken before a purge may still contain the data. Production would need backup-aware retention.

**Agent safety.**
- The LLM only proposes `{tool_name, service}` with a rationale and memory citations, as Pydantic-validated JSON.
- The policy node is deterministic. The tool must be in the registry, args must validate with `extra=forbid`, and state changes may only target the incident's own service.
- State-changing tools create an `approvals` record. `execute` re-validates it atomically in MongoDB: same tenant, same run, matching args hash, not yet consumed, approver still holds the role.
- A prompt-injected "approval granted" in the incident text cannot satisfy that check.
- Citations that don't match retrieved memories are dropped.
- The step budget (8) and repair attempts (2) bound loops.

**Independent verification.** The simulator never stores "access allowed". `verify` reloads persisted state from MongoDB and recomputes effective access from IAM statements (with wildcard matching and Deny), KMS decrypt principals and the network path. A tool's acknowledgement is not trusted.

**Memory write-back.** Memory is written only after verification passes. Content is generated deterministically from the run, not by the LLM, which limits memory poisoning. It records failed attempts and the diagnostics used. An equivalent active memory (same tenant/service/error/action) is *reconfirmed* (verification_count +1, confidence +0.02) rather than duplicated.

**A/B experiment.**
- Two runs with an identical incident, tool registry, model and temperature, and pre-approval policy (operator with the approver role, recorded in audit).
- The simulator is reset before each arm and after.
- `write_memory=False` in both arms, so arm A cannot seed arm B.
- Metrics: tool calls, diagnostic calls, state-changing calls, LLM decisions, tool sequence, retrieved memory IDs, per-decision citations.
- If sequences are identical, the UI says so.

**Sync PyMongo.** FastAPI runs sync endpoints in a threadpool, LangGraph nodes stay simple, and mongomock can replace the DB in unit tests. Async PyMongo is a drop-in later if needed.

## Known limitations (honest list)
- One incident category (Secrets Manager access). Simulator, not AWS.
- Agent runs are synchronous HTTP requests (~10–40 s with Gemini); no streaming.
- Graph state is persisted per node in `agent_runs`, but resumption is custom (no LangGraph checkpointer).
- `HashEmbedder` in unit tests is lexical, not semantic. Semantic relevance is asserted only in the live integration suite.
- Gemini at temperature 0 is not perfectly deterministic. A/B results can vary between runs, so report what you measure.
