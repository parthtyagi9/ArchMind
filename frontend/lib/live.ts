// Live backend client (FastAPI → MongoDB Atlas $vectorSearch + Voyage embeddings + Gemini).
// Requests go to /api/* and are proxied to the backend by next.config.ts rewrites.
import type { AgentSpec, FinalAnswer, Memory, Run, Selection, User } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j); } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

type BackendUser = { user_id: string; name: string; title: string; role: string; team: string; tenant_id: string; tenant_name: string; roles: string[] };

export const toUser = (u: BackendUser): User => ({
  id: u.user_id, name: u.name, title: `${u.title} · ${u.role}`, tenant: u.tenant_id, tenantName: u.tenant_name,
  team: u.team, canApprove: u.roles.includes("approver"),
});

export async function loadUsers(): Promise<User[]> {
  return (await api<BackendUser[]>("/session/users")).map(toUser);
}

export async function login(userId: string): Promise<void> {
  await api("/session/login", { user_id: userId });
}

export interface EvidenceItem { kind: string; ref: string; title: string; detail: string }

export function evidenceFrom(agents: AgentSpec[]): EvidenceItem[] {
  return agents
    .filter((a) => a.id !== "memory" && !a.skipped)
    .flatMap((a) => a.findings.map((f) => ({ kind: a.id, ref: f.ref, title: f.title, detail: f.detail ?? "" })));
}

export interface LiveRun extends Run { model?: string }

export async function liveAsk(question: string, memoryOn: boolean, evidence: EvidenceItem[], selection?: Selection | null): Promise<LiveRun> {
  return api<LiveRun>("/arch/ask", { question, memory_on: memoryOn, evidence, selection: selection ?? null });
}

export async function liveCompare(question: string, evidence: EvidenceItem[]): Promise<{ off: LiveRun; on: LiveRun; changed: boolean; same_model: boolean }> {
  return api("/arch/compare", { question, evidence });
}

/** Memory sub-agent card built from what the backend actually retrieved. */
export function memoryAgentFrom(run: LiveRun, memoryOn: boolean): AgentSpec {
  if (!memoryOn) return { id: "memory", label: "Memory agent", tools: [], durationMs: 0, findings: [], summary: "Governed memory is switched off for this question.", skipped: true };
  const step = run.steps.find((s) => s.name.startsWith("Memory agent"));
  const used = run.retrieved.filter((r) => r.used);
  return {
    id: "memory", label: "Memory agent", durationMs: Math.max(600, step?.ms ?? 800),
    tools: [step?.detail ?? "$vectorSearch on arch_memories"],
    findings: run.retrieved.map((r) => ({ ref: `${r.id}@v${r.version}`, title: r.title, detail: `similarity ${r.score.toFixed(3)}${r.used ? " · cited by the reasoning agent" : " · retrieved, not cited"}` })),
    summary: used.length ? `${used.length} approved memor${used.length === 1 ? "y" : "ies"} applied (${run.retrieved.length} retrieved, ${run.excluded} excluded by governance).` : `No retrieved memory applied (${run.retrieved.length} retrieved, ${run.excluded} excluded by governance).`,
  };
}

export function finalFrom(run: LiveRun): FinalAnswer {
  const a = run.answer;
  const used = run.retrieved.filter((r) => r.used);
  return {
    headline: a.decisionLabel, paragraphs: [a.summary, a.currentArchitecture].filter(Boolean), advice: a.recommendation,
    constraints: a.constraints, memoryRefs: used.map((r) => ({ id: r.id, title: r.title, version: r.version })),
    affected: a.affectedComponents, evidence: a.sources.map((s) => s.ref), risks: a.risks, decision: a.decision, caution: run.memoryInfluenced,
  };
}

export const memoryActions = {
  approve: (id: string, content?: string) => api<Memory>(`/arch/memories/${id}/approve`, { content: content ?? null }),
  reject: (id: string) => api<Memory>(`/arch/memories/${id}/reject`, {}),
  correct: (id: string, content: string, note: string) => api<Memory>(`/arch/memories/${id}/correct`, { content, note }),
  revoke: (id: string, reason: string) => api<Memory>(`/arch/memories/${id}/revoke`, { reason }),
  propose: (title: string, content: string, components: string[], runId: string) => api<Memory>("/arch/memories", { title, content, components, run_id: runId }),
};
