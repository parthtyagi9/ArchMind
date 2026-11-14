// Small typed fetch client for the ArchMind API. All paths are relative to /api (proxied to FastAPI).
import type {
  AuditEvent, Compare, ComponentDetail, Graph, GithubRepos, Group, GroupGraph, Integrations, AtlassianInfo, Invite, Me, Memory,
  OrgMember, Repo, RepoFile, Run, SearchResponse, Selection, SourceRef, TreeFile, Role, MemoryType, Scope,
} from "@/lib/types";

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/** Fired when a request (other than login/register/me) comes back 401, i.e. the session expired. */
export const UNAUTHORIZED_EVENT = "archmind:unauthorized";

export const errorMessage = (e: unknown): string =>
  e instanceof ApiError ? e.detail : e instanceof Error ? e.message : "Something went wrong.";

type Query = Record<string, string | number | boolean | null | undefined>;

function detailOf(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((item: unknown) => {
          if (item && typeof item === "object") {
            const o = item as { loc?: unknown; msg?: unknown };
            const loc = Array.isArray(o.loc) ? o.loc.filter((p) => p !== "body").join(".") : "";
            const msg = typeof o.msg === "string" ? o.msg : JSON.stringify(item);
            return loc ? `${loc}: ${msg}` : msg;
          }
          return String(item);
        })
        .join("; ");
    }
    if (d != null) return JSON.stringify(d);
  }
  return fallback;
}

function queryString(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}${queryString(opts.query)}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: opts.body !== undefined ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the ArchMind server. Check that the backend is running and try again.");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const sessionPath = path === "/auth/me" || path === "/auth/login" || path === "/auth/register";
    if (res.status === 401 && !sessionPath && typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, detailOf(data, res.statusText || `Request failed (${res.status})`));
  }
  return data as T;
}

const get = <T>(path: string, query?: Query) => request<T>("GET", path, { query });
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, { body: body ?? {} });
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, { body });
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, { body });
const del = <T>(path: string) => request<T>("DELETE", path);
const enc = encodeURIComponent;

export interface NewMemoryBody {
  title: string;
  content: string;
  memory_type: MemoryType;
  scope: Scope;
  team?: string;
  repo_id?: string;
  group_id?: string;
  components?: string[];
  source_refs?: SourceRef[];
  expires_in_days?: number | null;
}

export interface AtlassianBody {
  base_url: string;
  email: string;
  api_token: string;
  jira_projects?: string[];
  confluence_spaces?: string[];
}

export interface RunBody {
  kind: "why" | "ask";
  question: string;
  repo_id?: string;
  group_id?: string;
  selection?: Selection;
  memory_enabled?: boolean;
}

export const api = {
  // auth
  authConfig: () => get<{ github_oauth: boolean }>("/auth/config"),
  register: (b: { email: string; password: string; name: string; org_name?: string; invite_code?: string }) => post<Me>("/auth/register", b),
  login: (b: { email: string; password: string }) => post<Me>("/auth/login", b),
  logout: () => post<{ ok: boolean }>("/auth/logout"),
  me: () => get<Me>("/auth/me"),
  switchOrg: (org_id: string) => post<Me>("/auth/switch-org", { org_id }),

  // organization
  createOrg: (name: string) => post<Me>("/org", { name }),
  members: () => get<OrgMember[]>("/org/members"),
  updateMember: (userId: string, b: { role?: Role; team?: string | null }) => patch<OrgMember>(`/org/members/${enc(userId)}`, b),
  removeMember: (userId: string) => del<{ ok: boolean }>(`/org/members/${enc(userId)}`),
  invites: () => get<Invite[]>("/org/invites"),
  createInvite: (b: { role: "admin" | "member"; team?: string; expires_days?: number }) => post<Invite>("/org/invites", b),
  deleteInvite: (code: string) => del<{ ok: boolean }>(`/org/invites/${enc(code)}`),

  // integrations
  integrations: () => get<Integrations>("/integrations"),
  putAtlassian: (b: AtlassianBody) => put<AtlassianInfo>("/integrations/atlassian", b),
  deleteAtlassian: () => del<{ ok: boolean }>("/integrations/atlassian"),
  deleteGithub: () => del<{ ok: boolean }>("/integrations/github"),

  // repositories
  githubRepos: (q?: string) => get<GithubRepos>("/github/repos", { q }),
  connectRepo: (b: { full_name: string; branch?: string }) => post<Repo>("/repos", b),
  repos: () => get<Repo[]>("/repos"),
  repo: (id: string) => get<Repo>(`/repos/${enc(id)}`),
  reindexRepo: (id: string) => post<Repo>(`/repos/${enc(id)}/reindex`),
  deleteRepo: (id: string) => del<{ ok: boolean }>(`/repos/${enc(id)}`),
  tree: (id: string) => get<{ files: TreeFile[] }>(`/repos/${enc(id)}/tree`),
  file: (id: string, path: string) => get<RepoFile>(`/repos/${enc(id)}/file`, { path }),
  graph: (id: string) => get<Graph>(`/repos/${enc(id)}/graph`),
  component: (id: string, nodeId: string) => get<ComponentDetail>(`/repos/${enc(id)}/components/${enc(nodeId)}`),

  // repo groups
  groups: () => get<Group[]>("/groups"),
  createGroup: (b: { name: string; description?: string; repo_ids: string[] }) => post<Group>("/groups", b),
  updateGroup: (id: string, b: { name?: string; description?: string; repo_ids?: string[] }) => patch<Group>(`/groups/${enc(id)}`, b),
  deleteGroup: (id: string) => del<{ ok: boolean }>(`/groups/${enc(id)}`),
  groupTree: (id: string) => get<{ files: TreeFile[] }>(`/groups/${enc(id)}/tree`),
  groupGraph: (id: string) => get<GroupGraph>(`/groups/${enc(id)}/graph`),
  groupComponent: (id: string, nodeId: string) => get<ComponentDetail>(`/groups/${enc(id)}/components/${enc(nodeId)}`),

  // memory
  memories: (q: { status?: string; q?: string; repo_id?: string; group_id?: string } = {}) => get<Memory[]>("/memories", q),
  createMemory: (b: NewMemoryBody) => post<Memory>("/memories", b),
  memory: (id: string) => get<Memory>(`/memories/${enc(id)}`),
  approveMemory: (id: string, b: { content?: string; title?: string; reason?: string }) => post<Memory>(`/memories/${enc(id)}/approve`, b),
  rejectMemory: (id: string, reason: string) => post<Memory>(`/memories/${enc(id)}/reject`, { reason }),
  correctMemory: (id: string, b: { content: string; title?: string; reason: string }) => post<Memory>(`/memories/${enc(id)}/correct`, b),
  revokeMemory: (id: string, reason: string) => post<Memory>(`/memories/${enc(id)}/revoke`, { reason }),
  purgeMemory: (id: string, reason: string) => post<{ memory_id: string; versions_purged: number }>(`/memories/${enc(id)}/purge`, { reason }),
  searchMemories: (query: string, ctx: { repo_id?: string; group_id?: string } = {}) => post<SearchResponse>("/memories/search", { query, ...ctx }),

  // agent
  startRun: (b: RunBody) => post<{ run_id: string }>("/agent/runs", b),
  run: (id: string) => get<Run>(`/agent/runs/${enc(id)}`),
  runs: (q: { repo_id?: string; group_id?: string; limit?: number } = {}) => get<Run[]>("/agent/runs", q),
  proposeMemory: (runId: string) => post<Memory>(`/agent/runs/${enc(runId)}/propose-memory`),
  startCompare: (b: { question: string; repo_id?: string; group_id?: string; selection?: Selection }) => post<{ compare_id: string }>("/agent/compare", b),
  compare: (id: string) => get<Compare>(`/agent/compare/${enc(id)}`),

  // audit
  audit: (q: { memory_id?: string; run_id?: string; type?: string; limit?: number } = {}) => get<AuditEvent[]>("/audit", q),
};
