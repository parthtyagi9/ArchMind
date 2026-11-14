// TypeScript shapes of the ArchMind API contract (docs/api-contracts.md) plus a few UI-only types.

export type Role = "owner" | "admin" | "member";

export type Permission =
  | "ask"
  | "propose_memory"
  | "approve_memory"
  | "correct_memory"
  | "revoke_memory"
  | "connect_repo"
  | "manage_integrations"
  | "purge_memory"
  | "manage_members";

export interface Me {
  user: { id: string; email: string; name: string; github_login: string | null; avatar_url: string | null };
  org: { id: string; name: string; role: Role; team: string | null; permissions: string[] };
  orgs: { id: string; name: string; role: Role }[];
}

export interface Repo {
  id: string;
  full_name: string;
  branch: string;
  private: boolean;
  status: "indexing" | "ready" | "failed";
  progress: { done: number; total: number };
  error: string | null;
  file_count: number;
  indexed_at: string | null;
  connected_by: string;
  /** Semantic code search: chunks embedded with voyage-code-3 for the agent's code search. */
  search?: { status: "none" | "embedding" | "ready" | "failed" | "disabled"; done: number; total: number; model: string | null; error: string | null; indexed_at?: string | null };
}

export type SourceType = "jira" | "confluence" | "github" | "human" | "agent_run";
export interface SourceRef { type: SourceType; id: string; label: string; url: string | null }

export type MemoryType =
  | "architecture_decision"
  | "bug_resolution"
  | "repository_convention"
  | "code_ownership"
  | "engineering_preference"
  | "workaround"
  | "agent_experience";
export type MemoryStatus = "pending" | "active" | "superseded" | "invalidated" | "rejected" | "purged" | "expired";
export type Scope = "org" | "repo" | "team" | "group";
export type Authority = "agent_observed" | "human" | "verified";

export interface Memory {
  memory_id: string;
  version: number;
  version_id: string;
  title: string;
  content: string;
  memory_type: MemoryType;
  status: MemoryStatus;
  scope: Scope;
  team: string | null;
  repo_id: string | null;
  repo_name: string | null;
  group_id: string | null;
  group_name: string | null;
  authority: Authority;
  components: string[];
  source_refs: SourceRef[];
  created_by: { id: string; name: string };
  approved_by: { id: string; name: string } | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  retrieval_count: number;
  eligible: boolean;
  exclusion_reason: string | null;
  history?: Memory[];
}

export type FindingKind = "commit" | "pull_request" | "issue" | "page" | "memory" | "code";
export interface Finding { kind: FindingKind; ref: string; title: string; detail: string | null; url: string | null }

export type AgentId = "github" | "jira" | "confluence" | "memory";
export interface AgentStatus {
  id: AgentId;
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
  tools: { text: string; status: "running" | "done" | "error"; at: string }[];
  findings: Finding[];
  summary: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** In a group workspace `path` is "<owner>/<repo>/<file path>" in the UI; the API receives the file path plus `repo_id`. */
export interface Selection { path: string; start_line: number; end_line: number; text: string; repo_id?: string | null }

export type Verdict = "proceed" | "proceed_with_constraints" | "needs_architecture_review" | "insufficient_evidence";

export interface Answer {
  headline: string;
  explanation: string[];
  guidance: {
    verdict: Verdict;
    recommendation: string;
    constraints: { text: string; memory_ref: string }[];
    risks: string[];
  };
  evidence_refs: string[];
  affected_components: string[];
  confidence: "low" | "medium" | "high";
}

export interface Run {
  id: string;
  kind: "why" | "ask";
  status: "running" | "completed" | "failed";
  question: string;
  selection: Selection | null;
  repo_id: string | null;
  repo_name: string | null;
  group_id: string | null;
  group_name: string | null;
  memory_enabled: boolean;
  user: { id: string; name: string };
  created_at: string;
  finished_at: string | null;
  orchestrator: { status: "planning" | "done"; plan: AgentId[]; note: string };
  agents: AgentStatus[];
  memory: {
    retrieved: { memory_id: string; version: number; title: string; score: number; used: boolean }[];
    excluded: number;
    filter: { tenant_id: string; status: string; scopes: string[]; expires_after: string };
  };
  reasoning: { status: "pending" | "running" | "done" | "error"; model: string | null };
  answer: Answer | null;
  error: string | null;
  proposed_memory_id: string | null;
}

export interface AuditEvent {
  id: string;
  type: string;
  actor: { id: string; name: string } | null;
  memory_id: string | null;
  run_id: string | null;
  details: Record<string, unknown>;
  at: string;
}

export interface CompareDiff { field: string; without: string; with: string }
export interface Compare {
  id: string;
  status: "running" | "completed" | "failed";
  question: string;
  error: string | null;
  evidence_run_id: string | null;
  without_memory: Answer | null;
  with_memory: Answer | null;
  memories_used: { memory_id: string; version: number; title: string }[];
  changed: boolean | null;
  diff: CompareDiff[];
}

export interface GraphNode {
  id: string;
  label: string;
  kind: "service" | "package" | "module" | "datastore" | "config";
  path: string;
  file_count: number;
  loc: number;
  languages: string[];
  files: string[];
  memory_count: number;
  // group maps only
  component_id?: string;
  repo_id?: string;
  repo_name?: string;
}
export type EdgeKind = "imports" | "calls_api" | "depends_on_package";
export interface Endpoint { method: string; path: string }
export interface EdgeEvidence {
  call_file?: string; call_line?: number; call?: string; call_repo?: string;
  route_file?: string; route_line?: number; route?: string; route_repo?: string; score?: number;
  import_file?: string; import_repo?: string; package?: string; manifest_file?: string; manifest_repo?: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  weight: number;
  kind: EdgeKind;
  cross_repo?: boolean;
  endpoints?: Endpoint[];
  packages?: string[];
  confidence?: number;
  evidence?: EdgeEvidence[];
}
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }
export interface ApiRoute { method: string; path: string; raw: string; file: string; line: number; framework?: string }
export interface ApiCall { method: string; path: string; raw: string; host: string | null; file: string; line: number; repo_name?: string }
export interface GroupGraph extends Graph {
  group: { id: string; name: string };
  repos: { id: string; full_name: string; branch: string; status: Repo["status"]; file_count: number; interfaces_indexed: boolean; routes: number; calls: number }[];
  unmatched_calls: ApiCall[];
  stats: { routes: number; calls: number; cross_repo_edges: number };
}
export interface ComponentLink {
  id: string;
  label: string;
  weight: number;
  kind?: EdgeKind;
  repo_name?: string | null;
  cross_repo?: boolean;
  endpoints?: Endpoint[];
  packages?: string[];
  evidence?: EdgeEvidence[];
}
export interface ComponentDetail {
  node: GraphNode;
  depends_on: ComponentLink[];
  used_by: ComponentLink[];
  serves?: ApiRoute[];
  calls?: ApiCall[];
  recent_commits: Finding[];
  memories: Memory[];
}

// ---------- architecture map (class-level, from code analysis; names optionally from Gemini)
export type ArchRole =
  | "actor" | "router" | "page" | "component" | "client" | "endpoint" | "job" | "service" | "mapper" | "repository" | "entity" | "external" | "database";
export interface ArchNode {
  id: string;
  name: string;
  label: string;
  role: ArchRole;
  tier: "frontend" | "backend" | "external" | "actor";
  feature: string;
  file: string | null;
  line: number | null;
  lang?: string;
  kind?: string;
  component?: string;
  tags: string[];
  description: string | null;
  routes?: string[];
  ui_route?: string | null;
  schedule?: string | null;
  store?: string | null;
  repo_id?: string;
  repo_name?: string;
}
export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  kind: "uses" | "http" | "routes" | "stores" | "data" | "external" | "actor";
  label: string;
  methods: string[];
  endpoints: string[];
  tags: string[];
  evidence?: EdgeEvidence[];
  cross_repo?: boolean;
}
export interface ArchFeature { id: string; name: string; tier: "frontend" | "backend" | "external"; description: string | null; node_ids: string[]; repo_name?: string }
export interface ArchMap {
  nodes: ArchNode[];
  edges: ArchEdge[];
  features: ArchFeature[];
  hidden: Record<string, number>;
  unmatched_calls: ApiCall[];
  fingerprint: string;
  labels: { model: string | null; summary: string | null } | null;
  labels_status: "ready" | "missing" | "unavailable";
  repos?: { id: string; full_name: string; status: string }[];
}

export interface Group {
  id: string;
  name: string;
  description: string;
  repo_ids: string[];
  repos: Repo[];
  created_at: string;
  updated_at: string | null;
}

export interface TreeFile { path: string; size: number; language: string; repo_id?: string; repo_name?: string }
export interface RepoFile { path: string; content: string; language: string; size: number; sha: string }

export interface OrgMember { user_id: string; name: string; email: string; role: Role; team: string | null }
export interface Invite {
  code: string;
  role: Role;
  team: string | null;
  expires_at: string;
  uses: number;
  created_by: string | { id: string; name: string } | null;
}

export interface AtlassianInfo {
  connected: boolean;
  base_url: string | null;
  email: string | null;
  jira_projects: string[];
  confluence_spaces: string[];
  status: "ok" | "error" | null;
  error: string | null;
}
export interface Integrations {
  github: { connected: boolean; login: string | null; oauth_configured: boolean };
  atlassian: AtlassianInfo;
}

export interface GithubRepoItem { full_name: string; private: boolean; default_branch: string; description: string | null; updated_at: string }
export interface GithubRepos { connected: boolean; repos: GithubRepoItem[] }

export interface SearchResult { memory: Memory; score: number }
export interface SearchResponse { results: SearchResult[]; excluded: number }

// ---------- UI-only types ----------

export type PageId = "governance" | "memory" | "approvals" | "history" | "runs" | "compare" | "settings";

export type Tab =
  | { id: string; kind: "file"; path: string }
  | { id: string; kind: "arch" }
  | { id: string; kind: "page"; page: PageId };

export type Workspace =
  | { kind: "repo"; repoId: string }
  | { kind: "group"; groupId: string }
  | { kind: "local"; name: string; files: Record<string, string> };
