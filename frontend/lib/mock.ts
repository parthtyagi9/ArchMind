// SYNTHETIC DEMONSTRATION DATA. Nothing here is read from GitHub, Jira, Confluence or MongoDB yet.
// The UI labels it as such. Replace with API calls as the backend lands.
import type { ArchEdge, ArchNode, Answer, AuditEvent, Memory, Run, User } from "./types";

// Fixed "now" so expiry demos are deterministic.
export const DEMO_NOW = new Date("2026-11-14T11:45:00Z");

export const REPO = { name: "acme/payments-platform", branch: "main", files: 142, indexed: "2 min ago" };

export const USERS: User[] = [
  { id: "alice", name: "Alice Chen", title: "Staff engineer · approver", tenant: "org_alpha", tenantName: "Alpha Payments", team: "payments", canApprove: true },
  { id: "dev", name: "Dev Patel", title: "Developer", tenant: "org_alpha", tenantName: "Alpha Payments", team: "payments", canApprove: false },
  { id: "carol", name: "Carol Nguyen", title: "Mobile developer", tenant: "org_alpha", tenantName: "Alpha Payments", team: "mobile", canApprove: false },
  { id: "bob", name: "Bob Okafor", title: "Platform lead · approver", tenant: "org_beta", tenantName: "Beta Logistics", team: "platform", canApprove: true },
];

// ---------------------------------------------------------------- architecture graph
export const NODES: ArchNode[] = [
  {
    id: "clients", label: "Web & Mobile Clients", kind: "external", x: 90, y: 300,
    purpose: "Customer-facing apps calling the public API.", owner: "Mobile team",
    files: [], docs: [], tickets: [], memoryIds: [],
  },
  {
    id: "api-gateway", label: "api-gateway", kind: "service", x: 300, y: 300,
    purpose: "Edge router: rate limiting, routing, request logging. Does not validate tokens today.", owner: "Platform team",
    files: [{ path: "services/gateway/src/router.ts", lines: "1-96" }, { path: "services/gateway/src/rateLimit.ts", lines: "1-54" }],
    docs: [{ title: "Gateway request lifecycle", source: "confluence" }],
    tickets: [{ id: "PLAT-88", title: "Evaluate JWT validation at the edge", status: "Open" }],
    memoryIds: ["m_gateway"],
  },
  {
    id: "user-directory", label: "user-directory", kind: "service", x: 300, y: 110,
    purpose: "User profiles and role lookups.", owner: "Platform team",
    files: [{ path: "services/users/src/directory.ts", lines: "1-140" }], docs: [], tickets: [], memoryIds: [],
  },
  {
    id: "auth-service", label: "auth-service", kind: "service", x: 540, y: 150,
    purpose: "Issues and validates JWTs, owns session lifecycle and refresh tokens.", owner: "Platform team",
    files: [
      { path: "services/auth/src/index.ts", lines: "1-88" },
      { path: "services/auth/src/session.ts", lines: "12-130" },
      { path: "services/auth/src/refresh.ts", lines: "1-72" },
    ],
    docs: [{ title: "Authentication architecture", source: "confluence" }, { title: "Token lifecycle & rotation", source: "confluence" }],
    tickets: [{ id: "AUTH-311", title: "Tokens accepted without audience check", status: "Done" }, { id: "AUTH-298", title: "Pin jwt library after 4.3 regression", status: "Done" }],
    memoryIds: ["m_audience", "m_owner", "m_pin", "m_gateway"],
  },
  {
    id: "token-validator", label: "token-validator", kind: "module", x: 790, y: 70,
    purpose: "Verifies signature, expiry and audience of incoming JWTs.", owner: "Platform team",
    files: [{ path: "services/auth/src/validate.ts", lines: "1-64" }],
    docs: [], tickets: [{ id: "AUTH-311", title: "Tokens accepted without audience check", status: "Done" }],
    memoryIds: ["m_audience", "m_pin"],
  },
  {
    id: "authz-middleware", label: "authz-middleware", kind: "module", x: 790, y: 210,
    purpose: "Centralized authorization middleware shared by all services.", owner: "Platform team",
    files: [{ path: "packages/authz/src/middleware.ts", lines: "1-110" }],
    docs: [{ title: "Authorization conventions", source: "confluence" }], tickets: [],
    memoryIds: ["m_authz"],
  },
  {
    id: "payments-service", label: "payments-service", kind: "service", x: 540, y: 340,
    purpose: "Processes payments, maintains transaction balances, emits receipts.", owner: "Payments team",
    files: [
      { path: "services/payments/src/index.ts", lines: "1-120" },
      { path: "services/payments/src/balance.ts", lines: "8-96" },
      { path: "services/payments/src/charge.ts", lines: "1-210" },
    ],
    docs: [{ title: "Payments consistency model", source: "confluence" }, { title: "Payment service runbook", source: "confluence" }],
    tickets: [{ id: "PAY-142", title: "Stale balance shown after concurrent debit", status: "Done" }, { id: "PAY-171", title: "Investigate read latency on balance endpoint", status: "In progress" }],
    memoryIds: ["m_redis", "m_authz", "m_pg"],
  },
  {
    id: "ledger-writer", label: "ledger-writer", kind: "module", x: 540, y: 490,
    purpose: "Writes double-entry ledger rows inside a single serializable transaction.", owner: "Payments team",
    files: [{ path: "services/payments/src/ledger/write.ts", lines: "1-88" }],
    docs: [{ title: "Payments consistency model", source: "confluence" }], tickets: [{ id: "PAY-142", title: "Stale balance shown after concurrent debit", status: "Done" }],
    memoryIds: ["m_redis", "m_pg"],
  },
  {
    id: "postgres-ledger", label: "PostgreSQL ledger", kind: "datastore", x: 800, y: 490,
    purpose: "Source of truth for transactional payment data.", owner: "Payments team",
    files: [{ path: "db/migrations/0042_ledger.sql", lines: "1-60" }],
    docs: [{ title: "Payments consistency model", source: "confluence" }], tickets: [],
    memoryIds: ["m_redis", "m_pg"],
  },
  {
    id: "redis-proposed", label: "Redis (proposed)", kind: "datastore", x: 800, y: 345, ghost: true,
    purpose: "Not in the repository. Shown only when an answer proposes introducing it.", owner: "—",
    files: [], docs: [], tickets: [{ id: "PAY-171", title: "Investigate read latency on balance endpoint", status: "In progress" }],
    memoryIds: ["m_redis"],
  },
  {
    id: "notification-service", label: "notification-service", kind: "service", x: 300, y: 490,
    purpose: "Sends payment receipts and alerts via email and push.", owner: "Mobile team",
    files: [{ path: "services/notify/src/send.ts", lines: "1-84" }], docs: [], tickets: [], memoryIds: [],
  },
];

export const EDGES: ArchEdge[] = [
  { from: "clients", to: "api-gateway", kind: "calls" },
  { from: "api-gateway", to: "auth-service", kind: "calls" },
  { from: "api-gateway", to: "payments-service", kind: "calls" },
  { from: "auth-service", to: "user-directory", kind: "calls" },
  { from: "auth-service", to: "token-validator", kind: "imports" },
  { from: "auth-service", to: "authz-middleware", kind: "imports" },
  { from: "payments-service", to: "authz-middleware", kind: "imports" },
  { from: "payments-service", to: "ledger-writer", kind: "imports" },
  { from: "ledger-writer", to: "postgres-ledger", kind: "writes" },
  { from: "payments-service", to: "postgres-ledger", kind: "reads" },
  { from: "payments-service", to: "notification-service", kind: "calls" },
  { from: "payments-service", to: "redis-proposed", kind: "proposed" },
];

// ---------------------------------------------------------------- memories
const org = "org_alpha";
const repo = "payments-platform";

export const SEED_MEMORIES: Memory[] = [
  {
    id: "m_redis", title: "Redis restrictions for payments", type: "architecture_decision", status: "approved", version: 2,
    content: "Redis may be used for non-transactional read caching, but must not be used as the source of truth for payment balances.",
    tenant: org, scope: "team", team: "payments", repo, authority: "verified", approvedBy: "Alice Chen",
    sources: [{ type: "jira", id: "PAY-142", label: "Stale balance after concurrent debit" }, { type: "confluence", id: "CONF-2210", label: "Payments consistency model" }],
    expiresAt: null, components: ["payments-service", "ledger-writer", "postgres-ledger", "redis-proposed"], usedInRuns: 7,
    history: [
      { version: 1, content: "Do not introduce Redis to the payments service.", status: "superseded", by: "Alice Chen", at: "2026-09-02 14:10", note: "Initial decision after PAY-142 incident" },
      { version: 2, content: "Redis may be used for non-transactional read caching, but must not be used as the source of truth for payment balances.", status: "approved", by: "Alice Chen", at: "2026-10-19 09:42", note: "Corrected: blanket ban was too broad" },
    ],
  },
  {
    id: "m_authz", title: "Use centralized authorization middleware", type: "repository_convention", status: "approved", version: 1,
    content: "New API endpoints must use the existing centralized authorization middleware (packages/authz). Do not add per-service auth checks.",
    tenant: org, scope: "org", team: "", repo, authority: "verified", approvedBy: "Alice Chen",
    sources: [{ type: "github", id: "PR #482", label: "Introduce packages/authz" }],
    expiresAt: null, components: ["authz-middleware", "payments-service", "auth-service"], usedInRuns: 4,
    history: [{ version: 1, content: "New API endpoints must use the existing centralized authorization middleware (packages/authz). Do not add per-service auth checks.", status: "approved", by: "Alice Chen", at: "2026-08-14 16:30", note: "Imported from PR #482 review" }],
  },
  {
    id: "m_audience", title: "Token audience validation incident", type: "bug_resolution", status: "approved", version: 1,
    content: "A past authentication issue was caused by missing token audience validation. It was fixed in the validation module (token-validator); any relocation of validation must keep audience checks.",
    tenant: org, scope: "org", team: "", repo, authority: "verified", approvedBy: "Alice Chen",
    sources: [{ type: "jira", id: "AUTH-311", label: "Tokens accepted without audience check" }, { type: "github", id: "PR #377", label: "Add audience validation" }],
    expiresAt: null, components: ["auth-service", "token-validator"], usedInRuns: 3,
    history: [{ version: 1, content: "A past authentication issue was caused by missing token audience validation. It was fixed in the validation module (token-validator); any relocation of validation must keep audience checks.", status: "approved", by: "Alice Chen", at: "2026-07-21 11:05", note: "Verified against PR #377" }],
  },
  {
    id: "m_owner", title: "Platform team owns authentication", type: "code_ownership", status: "approved", version: 1,
    content: "The Platform team owns auth-service and token-validator. Changes to either require a Platform review.",
    tenant: org, scope: "org", team: "", repo, authority: "human", approvedBy: "Alice Chen",
    sources: [{ type: "github", id: "CODEOWNERS", label: "services/auth/ @platform" }],
    expiresAt: null, components: ["auth-service", "token-validator"], usedInRuns: 2,
    history: [{ version: 1, content: "The Platform team owns auth-service and token-validator. Changes to either require a Platform review.", status: "approved", by: "Alice Chen", at: "2026-06-30 10:00", note: "From CODEOWNERS" }],
  },
  {
    id: "m_gateway", title: "Gateway token validation (partial)", type: "architecture_decision", status: "approved", version: 1,
    content: "The gateway may verify token signatures, but audience and scope checks stay in the owning service until per-route audiences are configured at the edge.",
    tenant: org, scope: "org", team: "", repo, authority: "verified", approvedBy: "Alice Chen",
    sources: [{ type: "confluence", id: "CONF-1984", label: "Gateway request lifecycle" }, { type: "jira", id: "PLAT-88", label: "Evaluate JWT validation at the edge" }],
    expiresAt: null, components: ["api-gateway", "auth-service"], usedInRuns: 2,
    history: [{ version: 1, content: "The gateway may verify token signatures, but audience and scope checks stay in the owning service until per-route audiences are configured at the edge.", status: "approved", by: "Alice Chen", at: "2026-10-05 15:20", note: "Outcome of PLAT-88 design review" }],
  },
  {
    id: "m_pg", title: "PostgreSQL for transactional data", type: "engineering_preference", status: "approved", version: 1,
    content: "Persistent transactional data uses PostgreSQL. Do not introduce additional persistence technologies without an architecture review.",
    tenant: org, scope: "repo", team: "", repo, authority: "human", approvedBy: "Alice Chen",
    sources: [{ type: "human", id: "alice", label: "Submitted by Alice Chen" }],
    expiresAt: null, components: ["payments-service", "postgres-ledger"], usedInRuns: 5,
    history: [{ version: 1, content: "Persistent transactional data uses PostgreSQL. Do not introduce additional persistence technologies without an architecture review.", status: "approved", by: "Alice Chen", at: "2026-05-11 09:15", note: "" }],
  },
  {
    id: "m_pin", title: "Workaround: pin jwt library to 4.2.1", type: "workaround", status: "approved", version: 1,
    content: "Pin the jwt library to 4.2.1 until the 4.3 clock-skew regression is fixed upstream.",
    tenant: org, scope: "org", team: "", repo, authority: "human", approvedBy: "Alice Chen",
    sources: [{ type: "jira", id: "AUTH-298", label: "Pin jwt library after 4.3 regression" }],
    expiresAt: "2026-10-31T00:00:00Z", components: ["auth-service", "token-validator"], usedInRuns: 1,
    history: [{ version: 1, content: "Pin the jwt library to 4.2.1 until the 4.3 clock-skew regression is fixed upstream.", status: "approved", by: "Alice Chen", at: "2026-09-12 13:00", note: "Temporary, expires 31 Oct" }],
  },
  {
    id: "m_memcached", title: "Use Memcached for session caching", type: "architecture_decision", status: "revoked", version: 1,
    content: "Session data may be cached in Memcached.", tenant: org, scope: "org", team: "", repo, authority: "human", approvedBy: "Alice Chen",
    sources: [{ type: "confluence", id: "CONF-1511", label: "Session caching options (outdated)" }],
    expiresAt: null, components: ["auth-service"], usedInRuns: 0, revokeReason: "Memcached was removed from the stack in the Q3 migration.",
    history: [{ version: 1, content: "Session data may be cached in Memcached.", status: "revoked", by: "Alice Chen", at: "2026-10-02 12:00", note: "Revoked: component removed" }],
  },
  {
    id: "m_p1", title: "Gateway should not terminate JWTs yet", type: "agent_experience", status: "pending", version: 1,
    content: "In an earlier investigation the agent found that moving JWT termination to the gateway would bypass the per-service audience checks added in AUTH-311.",
    tenant: org, scope: "org", team: "", repo, authority: "agent_observed",
    sources: [{ type: "agent_run", id: "run_0412", label: "Agent run 0412" }, { type: "jira", id: "AUTH-311", label: "Tokens accepted without audience check" }],
    expiresAt: null, components: ["api-gateway", "auth-service", "token-validator"], usedInRuns: 0,
    history: [{ version: 1, content: "In an earlier investigation the agent found that moving JWT termination to the gateway would bypass the per-service audience checks added in AUTH-311.", status: "pending", by: "ArchMind agent", at: "2026-11-13 17:48", note: "Proposed from run_0412" }],
  },
  {
    id: "m_p2", title: "Balance reads must hit the ledger", type: "architecture_decision", status: "pending", version: 1,
    content: "The balance endpoint currently reads directly from the PostgreSQL ledger; read replicas are acceptable only if replication lag is under 200 ms.",
    tenant: org, scope: "team", team: "payments", repo, authority: "agent_observed",
    sources: [{ type: "github", id: "balance.ts", label: "services/payments/src/balance.ts:8-96" }],
    expiresAt: null, components: ["payments-service", "postgres-ledger"], usedInRuns: 0,
    history: [{ version: 1, content: "The balance endpoint currently reads directly from the PostgreSQL ledger; read replicas are acceptable only if replication lag is under 200 ms.", status: "pending", by: "ArchMind agent", at: "2026-11-14 10:55", note: "Extracted from repository scan" }],
  },
  // A different organization. Alpha users must never see these.
  {
    id: "b_idem", title: "Carrier API calls must be idempotent", type: "repository_convention", status: "approved", version: 1,
    content: "All calls to carrier APIs must carry an idempotency key.", tenant: "org_beta", scope: "org", team: "", repo: "routing-engine", authority: "verified", approvedBy: "Bob Okafor",
    sources: [{ type: "github", id: "PR #91", label: "Idempotency keys" }], expiresAt: null, components: [], usedInRuns: 2,
    history: [{ version: 1, content: "All calls to carrier APIs must carry an idempotency key.", status: "approved", by: "Bob Okafor", at: "2026-09-01 10:00", note: "" }],
  },
  {
    id: "b_redis", title: "Redis is the primary route cache", type: "architecture_decision", status: "approved", version: 1,
    content: "Redis is approved as the primary cache for computed routes.", tenant: "org_beta", scope: "org", team: "", repo: "routing-engine", authority: "verified", approvedBy: "Bob Okafor",
    sources: [{ type: "confluence", id: "CONF-77", label: "Route cache design" }], expiresAt: null, components: [], usedInRuns: 1,
    history: [{ version: 1, content: "Redis is approved as the primary cache for computed routes.", status: "approved", by: "Bob Okafor", at: "2026-09-20 10:00", note: "" }],
  },
];

// ---------------------------------------------------------------- agent scenarios
export interface Scenario {
  id: string;
  label: string;
  question: string;
  keywords: string[];
  baseline: Answer;
  withMemory: Answer;
  requires: string[]; // memory ids that must be eligible for the memory-informed decision
  relevance: Record<string, number>; // vector-search scores for this question
}

export const SCENARIOS: Scenario[] = [
  {
    id: "redis",
    label: "Redis in the payment service",
    question: "Should we introduce Redis caching into the payment service?",
    keywords: ["redis", "cache", "caching", "in-memory"],
    requires: ["m_redis"],
    relevance: { m_redis: 0.91, m_pg: 0.78, m_memcached: 0.74, m_p2: 0.73, m_authz: 0.31 },
    baseline: {
      decision: "adopt_redis_cache",
      decisionLabel: "Adopt Redis read-through cache",
      summary: "Add Redis as a read-through cache in front of balance lookups to cut latency on the balance endpoint.",
      currentArchitecture: "payments-service reads balances directly from the PostgreSQL ledger (balance.ts) and ledger-writer writes inside one serializable transaction.",
      recommendation: "Introduce Redis for balance reads with a short TTL, invalidating on every ledger write. This relieves read pressure noted in PAY-171.",
      constraints: [],
      risks: ["Cache invalidation on concurrent debits", "Stale balances visible to customers", "New operational dependency"],
      affectedComponents: ["payments-service", "redis-proposed", "postgres-ledger"],
      sources: [
        { kind: "code", ref: "services/payments/src/balance.ts:8-96", label: "Balance lookup", snippet: "export async function getBalance(accountId: string) {\n  return db.query('SELECT balance FROM ledger_accounts WHERE id = $1', [accountId]);\n}" },
        { kind: "jira", ref: "PAY-171", label: "Investigate read latency on balance endpoint" },
      ],
      requiresApproval: false,
      confidence: "medium",
    },
    withMemory: {
      decision: "restrict_redis_to_non_critical",
      decisionLabel: "Redis only for non-critical reads",
      summary: "Do not cache payment balances in Redis. Redis is allowed for non-transactional read data only.",
      currentArchitecture: "payments-service reads balances directly from the PostgreSQL ledger (balance.ts); ledger-writer keeps balances consistent in a single serializable transaction.",
      recommendation: "Keep balances on PostgreSQL and address PAY-171 with indexing or read replicas. Consider Redis only for non-transactional data such as merchant metadata. If balances must be cached, open an architecture review to revisit decision “Redis restrictions for payments” (v2).",
      constraints: ["Redis must not be the source of truth for payment balances (approved decision, v2)", "No new persistence technology without architecture review"],
      risks: ["Read latency on balance endpoint remains until the replica or index work lands"],
      affectedComponents: ["payments-service", "postgres-ledger", "redis-proposed"],
      sources: [
        { kind: "code", ref: "services/payments/src/balance.ts:8-96", label: "Balance lookup", snippet: "export async function getBalance(accountId: string) {\n  return db.query('SELECT balance FROM ledger_accounts WHERE id = $1', [accountId]);\n}" },
        { kind: "jira", ref: "PAY-142", label: "Stale balance after concurrent debit" },
        { kind: "confluence", ref: "CONF-2210", label: "Payments consistency model" },
      ],
      requiresApproval: true,
      confidence: "high",
    },
  },
  {
    id: "auth",
    label: "Token validation in the gateway",
    question: "How does our authentication service work, and can we move token validation into the API gateway?",
    keywords: ["auth", "token", "gateway", "jwt", "validation"],
    requires: ["m_audience", "m_gateway"],
    relevance: { m_audience: 0.9, m_gateway: 0.88, m_authz: 0.8, m_owner: 0.76, m_pin: 0.69, m_memcached: 0.52, m_p1: 0.84 },
    baseline: {
      decision: "move_validation_to_gateway",
      decisionLabel: "Move validation to the gateway",
      summary: "Token validation can move to api-gateway, centralizing it at the edge.",
      currentArchitecture: "auth-service issues JWTs and validates them through token-validator. api-gateway only routes and rate-limits; each downstream service calls authz-middleware.",
      recommendation: "Add JWT verification to the gateway router and let downstream services trust a forwarded identity header. Remove token-validator calls from payments-service.",
      constraints: [],
      risks: ["Downstream services trust headers set by the gateway", "Gateway becomes a single point of failure for auth"],
      affectedComponents: ["api-gateway", "auth-service", "token-validator", "payments-service"],
      sources: [
        { kind: "code", ref: "services/auth/src/validate.ts:1-64", label: "Token validation", snippet: "export function validate(token: string) {\n  const claims = jwt.verify(token, key);\n  return claims;\n}" },
        { kind: "confluence", ref: "Authentication architecture", label: "Authentication architecture" },
      ],
      requiresApproval: false,
      confidence: "medium",
    },
    withMemory: {
      decision: "phased_move_keep_audience_checks",
      decisionLabel: "Phased move, audience checks stay",
      summary: "The gateway may verify signatures, but audience and scope validation must stay in the owning services for now.",
      currentArchitecture: "auth-service issues JWTs; token-validator checks signature, expiry and audience (added after AUTH-311). All services use packages/authz middleware. api-gateway does not validate tokens.",
      recommendation: "Phase 1: verify signatures at the gateway. Keep audience and scope checks in-service. New gateway routes must use the centralized authorization middleware. Coordinate with the Platform team, who own auth-service.",
      constraints: ["Audience validation must be preserved (AUTH-311 resolution)", "Gateway may verify signatures only (approved decision v1)", "New endpoints use centralized authz middleware", "Platform review required for auth-service changes"],
      risks: ["Per-route audiences need edge configuration before full migration"],
      affectedComponents: ["api-gateway", "auth-service", "token-validator", "authz-middleware"],
      sources: [
        { kind: "code", ref: "services/auth/src/validate.ts:1-64", label: "Token validation", snippet: "export function validate(token: string) {\n  const claims = jwt.verify(token, key, { audience: EXPECTED_AUD });\n  return claims;\n}" },
        { kind: "jira", ref: "AUTH-311", label: "Tokens accepted without audience check" },
        { kind: "jira", ref: "PLAT-88", label: "Evaluate JWT validation at the edge" },
        { kind: "confluence", ref: "Gateway request lifecycle", label: "Gateway request lifecycle" },
      ],
      requiresApproval: true,
      confidence: "high",
    },
  },
];

// ---------------------------------------------------------------- seed history
export const SEED_EVENTS: AuditEvent[] = [
  { id: "e1", at: "2026-11-14 10:55", type: "memory.created", actor: "ArchMind agent", memoryId: "m_p2", detail: "Proposed memory from repository scan (pending approval)" },
  { id: "e2", at: "2026-11-13 17:48", type: "memory.created", actor: "ArchMind agent", memoryId: "m_p1", detail: "Proposed memory from run_0412 (pending approval)" },
  { id: "e3", at: "2026-11-02 09:00", type: "memory.expired", actor: "system", memoryId: "m_pin", detail: "Workaround expired on 2026-10-31; excluded from retrieval" },
  { id: "e4", at: "2026-10-19 09:42", type: "memory.corrected", actor: "Alice Chen", memoryId: "m_redis", detail: "Corrected v1 → v2; v1 marked superseded; new embedding generated" },
  { id: "e5", at: "2026-10-02 12:00", type: "memory.revoked", actor: "Alice Chen", memoryId: "m_memcached", detail: "Revoked: Memcached removed from the stack" },
  { id: "e6", at: "2026-10-05 15:20", type: "memory.approved", actor: "Alice Chen", memoryId: "m_gateway", detail: "Approved v1 from PLAT-88 design review" },
  { id: "e7", at: "2026-09-02 14:10", type: "memory.approved", actor: "Alice Chen", memoryId: "m_redis", detail: "Approved v1 (from PAY-142)" },
  { id: "e8", at: "2026-09-14 10:21", type: "authz.denied", actor: "Carol Nguyen", memoryId: "m_redis", detail: "Team-scoped memory (payments) not retrievable by team mobile" },
];

export const SEED_RUNS: Run[] = [];
