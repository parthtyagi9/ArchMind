# Roadmap

**V1 (this hackathon):** one incident category, governed semantic memory on Atlas Vector Search, tenant isolation, correction/invalidation/purge/expiry, LangGraph recovery workflow with approval + independent verification, simulated AWS, controlled A/B.

**V2 (team pilot):** more incident types (K8s, CloudWatch, GitHub Actions), Slack approvals, streaming runs, LangGraph checkpointer in MongoDB, memory confidence from historical success rate, hybrid retrieval (vector + Atlas Search keyword + recency + verified-outcome boost), RBAC admin.

**V3 (production-inspired):** SSO/RBAC, idempotent tool execution with operation ids, encryption + customer-managed retention, backup-aware purge, conflict detection between contradictory memories, freshness invalidation on infra change events, evaluation datasets.

**V4 (SaaS):** multi-org onboarding, connector ecosystem, usage metering, memory quality analytics.

## Open engineering questions
- Dedup: we reconfirm equivalent memories; near-duplicates with different wording still need clustering.
- Conflicts: two verified fixes for the same signature. Rank by recency × verification_count, surface the conflict to humans.
- Freshness: subscribe to IaC or deploy events to auto-expire memories that reference changed resources.
- Evaluation: run the A/B over N seeds and incident variants; report the distribution, not a single run.
