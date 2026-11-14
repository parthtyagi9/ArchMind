// Shared UI types. These mirror the shapes in the product brief; they are not a final API contract.

export type NodeKind = "service" | "module" | "datastore" | "external";
export type EdgeKind = "imports" | "calls" | "reads" | "writes" | "proposed";

export interface ArchNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  ghost?: boolean; // not present in the repo (e.g. a proposed component)
  purpose: string;
  owner: string;
  files: { path: string; lines: string }[];
  docs: { title: string; source: "confluence" }[];
  tickets: { id: string; title: string; status: string }[];
  memoryIds: string[];
}

export interface ArchEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export type MemoryType =
  | "architecture_decision"
  | "bug_resolution"
  | "repository_convention"
  | "code_ownership"
  | "agent_experience"
  | "engineering_preference"
  | "workaround";

export type MemoryStatus = "approved" | "pending" | "superseded" | "revoked" | "expired" | "rejected";
export type Authority = "verified" | "human" | "agent_observed";
export type Scope = "org" | "team" | "repo";

export interface SourceRef {
  type: "jira" | "confluence" | "github" | "human" | "agent_run";
  id: string;
  label: string;
}

export interface MemoryVersion {
  version: number;
  content: string;
  status: MemoryStatus;
  by: string;
  at: string;
  note: string;
}

export interface Memory {
  id: string;
  title: string;
  content: string;
  type: MemoryType;
  status: MemoryStatus;
  version: number;
  tenant: string;
  scope: Scope;
  team: string; // meaningful when scope === "team"
  repo: string;
  authority: Authority;
  approvedBy?: string;
  sources: SourceRef[];
  expiresAt: string | null;
  components: string[];
  history: MemoryVersion[];
  usedInRuns: number;
  revokeReason?: string;
}

export interface User {
  id: string;
  name: string;
  title: string;
  tenant: string;
  tenantName: string;
  team: string;
  canApprove: boolean;
}

export interface ChatSource {
  kind: "code" | "jira" | "confluence";
  ref: string;
  label: string;
  snippet?: string;
}

export interface Answer {
  decision: string;
  decisionLabel: string;
  summary: string;
  currentArchitecture: string;
  recommendation: string;
  constraints: string[];
  risks: string[];
  affectedComponents: string[];
  sources: ChatSource[];
  requiresApproval: boolean;
  confidence: "low" | "medium" | "high";
}

export interface RetrievedMemory {
  id: string;
  version: number;
  title: string;
  score: number;
  used: boolean;
}

export interface RunStep {
  name: string;
  detail: string;
  ms: number;
  kind: "deterministic" | "llm" | "retrieval";
}

export interface Run {
  id: string;
  at: string;
  userName: string;
  tenant: string;
  questionId: string;
  question: string;
  memoryOn: boolean;
  memoryInfluenced: boolean;
  retrieved: RetrievedMemory[];
  excluded: number;
  answer: Answer;
  steps: RunStep[];
}

export interface AuditEvent {
  id: string;
  at: string;
  type:
    | "memory.created"
    | "memory.approved"
    | "memory.rejected"
    | "memory.corrected"
    | "memory.revoked"
    | "memory.expired"
    | "retrieval"
    | "agent.decision"
    | "authz.denied";
  actor: string;
  memoryId?: string;
  detail: string;
}

export type ViewId = "explorer" | "assistant" | "memory" | "approvals" | "history" | "runs" | "compare";

// ---------------------------------------------------------------- IDE workspace
export interface Workspace {
  name: string;
  source: "github" | "local";
  demo: boolean; // true only for the bundled synthetic repository (graph, history and tickets exist for it)
  files: Record<string, string>;
}

export type Tab =
  | { id: string; kind: "file"; path: string }
  | { id: string; kind: "arch" }
  | { id: string; kind: "page"; page: ViewId };

export interface Selection {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface Finding {
  ref: string;
  title: string;
  detail?: string;
}

export type AgentId = "github" | "jira" | "confluence" | "memory";

export interface AgentSpec {
  id: AgentId;
  label: string;
  tools: string[]; // tool calls revealed progressively while the agent "runs"
  durationMs: number;
  findings: Finding[];
  summary: string;
  skipped?: boolean;
}

export interface FinalAnswer {
  headline: string;
  paragraphs: string[];
  advice: string;
  constraints: string[];
  memoryRefs: { id: string; title: string; version: number }[];
  affected: string[];
  evidence: string[];
  risks: string[];
  decision: string;
  caution: boolean;
}

export interface ThreadItem {
  id: string;
  startedAt: number;
  question: string;
  selection?: Selection;
  agents: AgentSpec[];
  final: FinalAnswer;
  runId: string;
}
