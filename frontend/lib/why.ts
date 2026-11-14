// Scripted provenance for the synthetic demo repository. Nothing here comes from real GitHub, Jira,
// Confluence or MongoDB. The shape mirrors what the sub-agents would return once integrations land.
import { isEligible } from "./agent";
import { matchScenario, runAgent } from "./agent";
import { SCENARIOS } from "./mock";
import type { AgentSpec, Finding, FinalAnswer, Memory, Run, Selection, ThreadItem, User } from "./types";

interface WhyEntry {
  id: string;
  path: string;
  keywords: string[]; // matched against the selected text
  lensKeyword: string; // the line that gets a code lens
  lensLabel: string;
  title: string;
  github: Finding[];
  jira: Finding[];
  confluence: Finding[];
  memoryIds: string[];
  narrative: string[];
  adviceBaseline: string;
  adviceMemory: string;
  affected: string[];
}

export const WHY: WhyEntry[] = [
  {
    id: "audience", path: "services/auth/src/validate.ts", keywords: ["audience", "EXPECTED_AUD", "jwt.verify", "validate"],
    lensKeyword: "audience: EXPECTED_AUD", lensLabel: "AUTH-311 · PR #377",
    title: "Audience check in token validation",
    github: [
      { ref: "PR #377", title: "Add audience validation to token verification", detail: "Merged 2026-07-19. Adds the audience option to jwt.verify and the EXPECTED_AUD config." },
      { ref: "a41c9e2", title: "fix(auth): reject tokens issued for other services", detail: "Commit that introduced `audience: EXPECTED_AUD` (git blame, L21)." },
      { ref: "PR #402", title: "Set clockTolerance to 5s", detail: "Added during the jwt 4.3 regression workaround." },
    ],
    jira: [
      { ref: "AUTH-311", title: "Tokens accepted without audience check", detail: "A token minted for notifications was accepted by payments, allowing cross-service replay. Done." },
      { ref: "AUTH-298", title: "Pin jwt library after 4.3 regression", detail: "Temporary workaround; related to the clock tolerance." },
    ],
    confluence: [
      { ref: "Authentication architecture", title: "§ Token validation", detail: "Every service must verify `aud`. The gateway terminates TLS only." },
      { ref: "Token lifecycle & rotation", title: "Refresh and expiry policy" },
    ],
    memoryIds: ["m_audience", "m_owner", "m_pin"],
    narrative: [
      "This `audience` option exists because of AUTH-311: a token issued for another service was accepted by payments, which allowed cross-service replay. PR #377 added the check and the Authentication architecture page now requires every service to verify `aud`.",
      "The `clockTolerance: 5` line is unrelated to security intent. It came later (PR #402) as part of the jwt 4.3 regression workaround tracked in AUTH-298.",
    ],
    adviceBaseline: "Removing or relocating this check would reopen AUTH-311. Make sure equivalent audience validation exists wherever token validation moves.",
    adviceMemory: "Approved memory says audience validation must be preserved if validation is relocated, and that the Platform team owns this module, so changes need a Platform review.",
    affected: ["auth-service", "token-validator"],
  },
  {
    id: "balance", path: "services/payments/src/balance.ts", keywords: ["SELECT balance", "getBalance", "balance_cents", "ledger_accounts", "strongly consistent"],
    lensKeyword: "SELECT balance_cents", lensLabel: "PAY-142 · PR #318",
    title: "Balance read straight from the ledger",
    github: [
      { ref: "PR #318", title: "Serve balance reads from the ledger only", detail: "Merged 2026-09-04. Removes the short-lived balance cache." },
      { ref: "9be07d1", title: "revert: remove balance cache", detail: "Reverts the caching layer (git blame, L7–L11)." },
    ],
    jira: [
      { ref: "PAY-142", title: "Stale balance shown after concurrent debit", detail: "Cache returned an old balance for up to 30s after a debit. Done." },
      { ref: "PAY-171", title: "Investigate read latency on balance endpoint", detail: "Open. Latency complaints that motivate caching again." },
    ],
    confluence: [
      { ref: "Payments consistency model", title: "§ Reads", detail: "Balances must be strongly consistent with the ledger." },
      { ref: "Payment service runbook", title: "§ Balance endpoint" },
    ],
    memoryIds: ["m_redis", "m_pg", "m_p2"],
    narrative: [
      "The balance is read directly from PostgreSQL because a short-lived cache produced stale balances after concurrent debits (PAY-142). PR #318 removed the cache, and the Payments consistency model requires balance reads to be strongly consistent.",
      "PAY-171 is still open: latency on this endpoint is the pressure to add caching again.",
    ],
    adviceBaseline: "A cache here is technically possible, but it recreates the PAY-142 failure mode unless it is invalidated atomically with ledger writes.",
    adviceMemory: "An approved decision (v2) says Redis must not be the source of truth for balances; read caching is allowed only for non-transactional data. Open an architecture review before changing this path.",
    affected: ["payments-service", "postgres-ledger", "redis-proposed"],
  },
  {
    id: "ledger", path: "services/payments/src/ledger/write.ts", keywords: ["SERIALIZABLE", "writeEntry", "BEGIN", "ROLLBACK"],
    lensKeyword: "SERIALIZABLE", lensLabel: "PAY-142 · PR #301",
    title: "Serializable ledger transaction",
    github: [{ ref: "PR #301", title: "Double-entry ledger in one serializable transaction", detail: "Merged 2026-08-22." }],
    jira: [{ ref: "PAY-142", title: "Stale balance shown after concurrent debit", detail: "Concurrent debits are what exposed the race." }],
    confluence: [{ ref: "Payments consistency model", title: "§ Writes", detail: "Debit, credit and entry insert commit atomically." }],
    memoryIds: ["m_redis", "m_pg"],
    narrative: ["Both account updates and the entry insert run in one SERIALIZABLE transaction so concurrent debits cannot corrupt balances. This is the write-side counterpart of the strongly consistent reads described in the consistency model."],
    adviceBaseline: "Lowering the isolation level or splitting the updates would reintroduce the concurrent-debit race from PAY-142.",
    adviceMemory: "Approved decisions keep PostgreSQL as the system of record for transactional data and require an architecture review before adding other persistence technologies.",
    affected: ["ledger-writer", "postgres-ledger"],
  },
  {
    id: "authz", path: "packages/authz/src/middleware.ts", keywords: ["authorizeRequest", "authorize", "middleware", "POLICIES"],
    lensKeyword: "export function authorizeRequest", lensLabel: "PR #482 · convention",
    title: "Centralized authorization middleware",
    github: [{ ref: "PR #482", title: "Introduce packages/authz", detail: "Replaces per-service role checks. Merged 2026-08-12." }],
    jira: [],
    confluence: [{ ref: "Authorization conventions", title: "§ Endpoints", detail: "All endpoints use authorizeRequest(action)." }],
    memoryIds: ["m_authz", "m_owner"],
    narrative: ["Authorization used to be re-implemented in each service. PR #482 centralized it so policy changes happen in one place, and the conventions page asks every new endpoint to mount `authorizeRequest`."],
    adviceBaseline: "Adding per-service checks would duplicate policy and drift from this module.",
    adviceMemory: "An approved convention requires new endpoints to use this middleware, and Platform owns the package.",
    affected: ["authz-middleware", "payments-service", "auth-service"],
  },
  {
    id: "gateway", path: "services/gateway/src/router.ts", keywords: ["downstream", "routes", "buildRouter", "createProxy"],
    lensKeyword: "Token validation is intentionally", lensLabel: "PLAT-88 · design review",
    title: "Gateway routes without validating tokens",
    github: [{ ref: "PR #212", title: "Gateway: routing and rate limiting only", detail: "Merged 2026-03-02." }],
    jira: [{ ref: "PLAT-88", title: "Evaluate JWT validation at the edge", detail: "Open. Blocked on per-route audience configuration." }],
    confluence: [{ ref: "Gateway request lifecycle", title: "§ Responsibilities", detail: "Gateway terminates TLS, routes and rate-limits." }],
    memoryIds: ["m_gateway", "m_audience", "m_p1"],
    narrative: ["The gateway deliberately skips token validation: it only routes and rate-limits, and each downstream service validates tokens itself (including the audience check from AUTH-311). PLAT-88 tracks evaluating edge validation, which is blocked on per-route audience configuration."],
    adviceBaseline: "Moving validation here is possible but would bypass the per-service audience checks unless they are replicated at the edge.",
    adviceMemory: "An approved decision lets the gateway verify signatures only; audience and scope checks stay in the owning service until per-route audiences exist at the edge.",
    affected: ["api-gateway", "auth-service", "token-validator"],
  },
];

export const entryForPath = (path: string) => WHY.find((w) => w.path === path);

export function entryFor(sel: Selection): WhyEntry | null {
  const candidates = WHY.filter((w) => w.path === sel.path);
  if (!candidates.length) return null;
  const t = sel.text.toLowerCase();
  return candidates.find((w) => w.keywords.some((k) => t.includes(k.toLowerCase()))) ?? candidates[0];
}

let seq = 0;
const nextId = (p: string) => `${p}_${Date.now()}_${++seq}`;

function memoryAgent(ids: string[], user: User, memories: Memory[], memoryOn: boolean, hint: string): { agent: AgentSpec; used: Memory[]; excluded: number } {
  const excluded = memories.filter((m) => !isEligible(m, user)).length;
  if (!memoryOn) {
    return { used: [], excluded, agent: { id: "memory", label: "Memory agent", tools: [], durationMs: 0, findings: [], summary: "Governed memory is switched off for this question.", skipped: true } };
  }
  const used = ids.map((id) => memories.find((m) => m.id === id)).filter((m): m is Memory => !!m && isEligible(m, user));
  return {
    used, excluded,
    agent: {
      id: "memory", label: "Memory agent", durationMs: 1200,
      tools: [
        `$vectorSearch “${hint.slice(0, 48)}” filter tenant=${user.tenant}, status=approved, expires>now`,
        `scope ∈ {org, repo, team:${user.team}} → ${used.length} eligible, ${excluded} excluded before the model`,
      ],
      findings: used.map((m) => ({ ref: `${m.id}@v${m.version}`, title: m.title, detail: m.content })),
      summary: used.length ? `${used.length} approved memor${used.length === 1 ? "y" : "ies"} apply.` : "No approved memory applies in your scope.",
    },
  };
}

function toRun(id: string, user: User, question: string, memoryOn: boolean, agents: AgentSpec[], f: FinalAnswer, used: Memory[], excluded: number): Run {
  return {
    id, at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), userName: user.name, tenant: user.tenant,
    questionId: "why", question, memoryOn, memoryInfluenced: used.length > 0,
    retrieved: used.map((m, i) => ({ id: m.id, version: m.version, title: m.title, score: 0.92 - i * 0.04, used: true })), excluded,
    answer: {
      decision: f.decision, decisionLabel: f.headline, summary: f.paragraphs[0] ?? "", currentArchitecture: f.paragraphs.slice(1).join(" "), recommendation: f.advice,
      constraints: f.constraints, risks: f.risks, affectedComponents: f.affected, sources: [], requiresApproval: false, confidence: used.length ? "high" : "medium",
    },
    steps: [
      { name: "Resolve identity", detail: `${user.name} → tenant ${user.tenant}, team ${user.team}`, ms: 4, kind: "deterministic" },
      { name: "Plan sub-agents", detail: agents.filter((a) => !a.skipped).map((a) => a.label).join(" · "), ms: 600, kind: "llm" },
      ...agents.map((a) => ({ name: a.label, detail: a.summary, ms: a.durationMs, kind: (a.id === "memory" ? "retrieval" : "retrieval") as "retrieval" })),
      { name: "Reasoning agent", detail: "Combine evidence, separate facts from memory", ms: 1100, kind: "llm" as const },
      { name: "Record decision trace", detail: "Wrote agent_runs + audit_events", ms: 22, kind: "deterministic" as const },
    ],
  };
}

export interface Built { item: ThreadItem; run: Run }

/** "Why does this exist?" for a selected code range. */
export function buildWhy(sel: Selection, question: string, user: User, memories: Memory[], memoryOn: boolean): Built {
  const w = entryFor(sel);
  const id = nextId("why");
  const mem = memoryAgent(w?.memoryIds ?? [], user, memories, memoryOn, `${question} ${sel.text}`);

  const agents: AgentSpec[] = w
    ? [
        { id: "github", label: "GitHub agent", durationMs: 1500, tools: [`git blame ${sel.path}:${sel.startLine}-${sel.endLine}`, "search pull requests touching this file", "read linked review threads"], findings: w.github, summary: `${w.github.length} change${w.github.length === 1 ? "" : "s"} found.` },
        { id: "jira", label: "Jira agent", durationMs: 2100, tools: [`JQL: text ~ "${w.keywords[0]}" ORDER BY updated DESC`, "follow issue links and comments"], findings: w.jira, summary: w.jira.length ? `${w.jira.length} ticket${w.jira.length === 1 ? "" : "s"} found.` : "No related tickets." },
        { id: "confluence", label: "Confluence agent", durationMs: 2600, tools: [`CQL: text ~ "${w.keywords[0]}" AND space = ENG`, "extract matching sections"], findings: w.confluence, summary: w.confluence.length ? `${w.confluence.length} page${w.confluence.length === 1 ? "" : "s"} found.` : "No related pages." },
        mem.agent,
      ]
    : [
        { id: "github", label: "GitHub agent", durationMs: 1000, tools: [`git blame ${sel.path}`], findings: [], summary: "No history available: open the repository from GitHub to enable blame and PR search." },
        { id: "jira", label: "Jira agent", durationMs: 1000, tools: ["integration not connected"], findings: [], summary: "Jira is not connected." },
        { id: "confluence", label: "Confluence agent", durationMs: 1000, tools: ["integration not connected"], findings: [], summary: "Confluence is not connected." },
        mem.agent,
      ];

  const constraints = memoryOn ? mem.used.filter((m) => m.status === "approved").map((m) => m.content) : [];
  const final: FinalAnswer = w
    ? {
        headline: w.title, paragraphs: w.narrative, advice: mem.used.length ? w.adviceMemory : w.adviceBaseline,
        constraints, memoryRefs: mem.used.map((m) => ({ id: m.id, title: m.title, version: m.version })), affected: w.affected,
        evidence: [...w.github, ...w.jira, ...w.confluence].map((f) => f.ref), risks: [], decision: "explain_code_origin", caution: mem.used.length > 0,
      }
    : {
        headline: "No provenance found in preview",
        paragraphs: ["The sub-agents could not find history for this code. Provenance lookup is only simulated for the bundled demo repository, and the GitHub, Jira and Confluence integrations are not wired yet."],
        advice: "Open the demo repository to see the full flow.", constraints: [], memoryRefs: [], affected: [], evidence: [], risks: [], decision: "explain_code_origin", caution: false,
      };

  const run = toRun(`run_w${String(seq).padStart(3, "0")}`, user, question, memoryOn, agents, final, mem.used, mem.excluded);
  return { item: { id, startedAt: Date.now(), question, selection: sel, agents, final, runId: run.id }, run };
}

/** Free-text architecture question (the two scripted scenarios). Returns null when nothing matches. */
export function buildAsk(question: string, user: User, memories: Memory[], memoryOn: boolean): Built | null {
  const s = matchScenario(question);
  if (!s) return null;
  const run = runAgent(s, memoryOn, user, memories, question);
  const a = run.answer;
  const pick = (k: string) => a.sources.filter((x) => x.kind === k).map((x) => ({ ref: x.ref, title: x.label, detail: x.snippet }));
  const used = run.retrieved.filter((r) => r.used);
  const agents: AgentSpec[] = [
    { id: "github", label: "GitHub agent", durationMs: 1500, tools: ["search code for relevant modules", "read imports and callers"], findings: pick("code"), summary: `${pick("code").length} file(s) read.` },
    { id: "jira", label: "Jira agent", durationMs: 2100, tools: ["JQL: related bugs and decisions"], findings: pick("jira"), summary: `${pick("jira").length} ticket(s) found.` },
    { id: "confluence", label: "Confluence agent", durationMs: 2600, tools: ["CQL: architecture pages"], findings: pick("confluence"), summary: `${pick("confluence").length} page(s) found.` },
    memoryOn
      ? { id: "memory", label: "Memory agent", durationMs: 1200, tools: [`$vectorSearch filter tenant=${user.tenant}, status=approved, expires>now`, `→ ${run.retrieved.length} retrieved, ${run.excluded} excluded`], findings: run.retrieved.map((r) => ({ ref: `${r.id}@v${r.version}`, title: r.title })), summary: used.length ? `${used.length} memor${used.length === 1 ? "y" : "ies"} applied.` : "No applicable memory." }
      : { id: "memory", label: "Memory agent", durationMs: 0, tools: [], findings: [], summary: "Governed memory is switched off.", skipped: true },
  ];
  const final: FinalAnswer = {
    headline: a.decisionLabel, paragraphs: [a.summary, a.currentArchitecture], advice: a.recommendation, constraints: a.constraints,
    memoryRefs: used.map((r) => ({ id: r.id, title: r.title, version: r.version })), affected: a.affectedComponents,
    evidence: a.sources.map((x) => x.ref), risks: a.risks, decision: a.decision, caution: run.memoryInfluenced,
  };
  return { item: { id: nextId("ask"), startedAt: Date.now(), question, agents, final, runId: run.id }, run };
}

export { SCENARIOS };
