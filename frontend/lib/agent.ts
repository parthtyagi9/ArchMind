// Demo-side stand-in for the governance policy and the agent run. The real versions live in the
// backend (retrieval filters are applied inside $vectorSearch). This only drives the UI preview.
import { DEMO_NOW, SCENARIOS, type Scenario } from "./mock";
import type { Memory, MemoryStatus, Run, RetrievedMemory, RunStep, User } from "./types";

export const isExpired = (m: Memory) => !!m.expiresAt && new Date(m.expiresAt) < DEMO_NOW;

export function effectiveStatus(m: Memory): MemoryStatus {
  return m.status === "approved" && isExpired(m) ? "expired" : m.status;
}

/** Tenant and team scope. Cross-tenant memories are invisible, not merely hidden in the UI. */
export const isVisible = (m: Memory, u: User) => m.tenant === u.tenant && (m.scope !== "team" || m.team === u.team);

export const isEligible = (m: Memory, u: User) => isVisible(m, u) && effectiveStatus(m) === "approved";

export function exclusionReason(m: Memory, u: User): string | null {
  if (m.tenant !== u.tenant) return "different organization";
  if (m.scope === "team" && m.team !== u.team) return `scoped to team “${m.team}”`;
  const s = effectiveStatus(m);
  return s === "approved" ? null : s;
}

export function matchScenario(text: string): Scenario | null {
  const t = text.toLowerCase();
  return SCENARIOS.find((s) => s.keywords.some((k) => t.includes(k))) ?? null;
}

let counter = 412;

export function runAgent(s: Scenario, memoryOn: boolean, user: User, memories: Memory[], question = s.question): Run {
  const eligible = memories.filter((m) => isEligible(m, user));
  const influenced = memoryOn && s.requires.every((id) => eligible.some((m) => m.id === id));
  const answer = influenced ? s.withMemory : s.baseline;

  const retrieved: RetrievedMemory[] = memoryOn
    ? eligible
        .filter((m) => (s.relevance[m.id] ?? 0) >= 0.6)
        .sort((a, b) => (s.relevance[b.id] ?? 0) - (s.relevance[a.id] ?? 0))
        .slice(0, 5)
        .map((m) => ({ id: m.id, version: m.version, title: m.title, score: s.relevance[m.id], used: influenced && (s.relevance[m.id] ?? 0) >= 0.75 }))
    : [];
  const excluded = memories.filter((m) => !isEligible(m, user)).length;

  const steps: RunStep[] = [
    { name: "Resolve identity", detail: `${user.name} → tenant ${user.tenant}, team ${user.team} (from session, not request)`, ms: 4, kind: "deterministic" },
    { name: "Classify intent", detail: `architecture_recommendation · scenario “${s.id}”`, ms: 640, kind: "llm" },
    { name: "Gather context", detail: "GitHub code retrieval · Jira search · Confluence search (parallel)", ms: 910, kind: "retrieval" },
    memoryOn
      ? { name: "Governed memory retrieval", detail: `$vectorSearch filter tenant=${user.tenant}, status=approved, expires>now, scope∈{org,repo,team:${user.team}} → ${retrieved.length} hit(s), ${excluded} excluded`, ms: 120, kind: "retrieval" }
      : { name: "Governed memory retrieval", detail: "Skipped: memory disabled for this run", ms: 0, kind: "retrieval" },
    { name: "Normalize & evaluate evidence", detail: "Rank by source authority, verification status, freshness", ms: 18, kind: "deterministic" },
    { name: "Architecture reasoning", detail: influenced ? "Constraints from approved memory applied" : "No approved constraints available", ms: 2300, kind: "llm" },
    { name: "Validate structured output", detail: "Schema check · citation check · policy check", ms: 9, kind: "deterministic" },
    { name: "Record decision trace", detail: "Wrote agent_runs + audit_events", ms: 22, kind: "deterministic" },
  ];

  counter += 1;
  return {
    id: `run_${String(counter).padStart(4, "0")}`,
    at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    userName: user.name,
    tenant: user.tenant,
    questionId: s.id,
    question,
    memoryOn,
    memoryInfluenced: influenced,
    retrieved,
    excluded,
    answer,
    steps,
  };
}
