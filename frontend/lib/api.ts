export type Me = { user_id: string; name: string; tenant_id: string; tenant_name: string; roles: string[] };
export type DemoUser = { user_id: string; name: string; tenant_name: string; roles: string[] };

export type Step = {
  n: number;
  kind: "classify" | "retrieve" | "plan" | "policy" | "tool" | "verify" | "memory" | "approval";
  tool?: string | null;
  args?: Record<string, unknown>;
  state_changing?: boolean;
  rationale?: string;
  hypothesis?: string;
  memory_ids_used?: string[];
  result?: unknown;
  note?: string;
  at: string;
};

export type Metrics = {
  tool_calls: number;
  diagnostic_calls: number;
  state_changing_calls: number;
  tool_sequence: string[];
  resolved: boolean;
  llm_decisions: number;
  llm_model?: string;
};

export type Run = {
  _id: string;
  incident_id: string;
  status: "running" | "awaiting_approval" | "resolved" | "failed" | "escalated" | "rejected";
  status_reason?: string;
  memory_enabled: boolean;
  steps: Step[];
  retrieved_memory_ids?: string[];
  memories?: Array<{ memory_id: string; version: number; content: string; score: number; resolution_action?: string; verification_status?: string }>;
  pending_action?: { tool: string; args: Record<string, unknown>; rationale?: string; memory_ids_used?: string[] } | null;
  verification?: { allowed: boolean; checks: Record<string, boolean>; failing_checks?: string[] } | null;
  memory_result?: Record<string, unknown> | null;
  metrics?: Metrics;
  classification?: { failure_category: string; summary: string };
};

export type Incident = {
  _id: string; service: string; environment: string; error_code: string; description: string; status: string; created_at: string;
};

export type Memory = {
  _id: string; memory_id: string; version: number; tenant_id: string; memory_type: string; service: string;
  error_code: string; content?: string; resolution_action?: string | null; outcome: string; confidence: number;
  verification_status: string; verification_count?: number; status: "active" | "superseded" | "invalidated" | "purged";
  source_incident_id?: string | null; source_run_id?: string | null; created_at: string; updated_at: string;
  expires_at: string; retrieval_count?: number; last_retrieved_at?: string | null; supersedes?: string | null;
  created_by?: string; invalidation_reason?: string; score?: number;
};

export type AuditEvent = {
  _id: string; event_type: string; actor: string; run_id?: string; memory_id?: string; incident_id?: string;
  details: Record<string, unknown>; created_at: string;
};

export type Experiment = {
  _id: string;
  arms: Record<"without_memory" | "with_memory", {
    run_id: string; status: string; status_reason?: string; metrics: Metrics; retrieved_memory_ids: string[];
    steps: Step[]; verification?: Run["verification"];
  }>;
  summary: { same_tool_sequence: boolean; tool_calls_delta: number; diagnostic_calls_delta: number; both_resolved: boolean; same_model?: boolean };
  controls: Record<string, unknown>;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
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

export const DEMO_INCIDENT = {
  service: "payment-service",
  environment: "staging",
  error_code: "AccessDeniedException",
  description:
    "Deploy of payment-service 2.14.0 to staging failed. Pods crash on startup while loading database credentials; logs show AccessDeniedException from AWS. No config changes were made to the app itself.",
};
