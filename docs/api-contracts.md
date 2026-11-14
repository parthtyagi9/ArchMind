# ArchMind API contract

Single source of truth between `frontend/` and `backend/`. All paths are under `/api`. The browser only
talks to the Next.js origin; `next.config.ts` proxies `/api/*` to FastAPI. Auth is an httpOnly cookie
(`archmind_session`), so every fetch uses `credentials: "include"` (same-origin: default).
Errors: JSON `{"detail": "message"}` with 400/401/403/404/409/422/502. 401 = not signed in. 403 = role is
not allowed. 502 = an upstream integration (GitHub/Jira/Confluence/LLM) failed; `detail` explains why.
**There is no demo data anywhere.** Everything shown is created by users or fetched from real systems.

Timestamps are ISO-8601 UTC strings. Tenant (org) identity is ALWAYS taken from the session; no request
body or query parameter can choose it.

## Roles and permissions

| role | permissions |
|---|---|
| `member` | `ask`, `propose_memory` |
| `admin` | member + `approve_memory`, `correct_memory`, `revoke_memory`, `connect_repo`, `manage_integrations` |
| `owner` | admin + `purge_memory`, `manage_members` |

`Me.org.permissions` lists the caller's permissions; the UI must disable/hide actions it lacks, but the
backend is what enforces them.

## Shared shapes

```ts
type Role = "owner" | "admin" | "member";

interface Me {
  user: { id: string; email: string; name: string; github_login: string | null; avatar_url: string | null };
  org: { id: string; name: string; role: Role; team: string | null; permissions: string[] };
  orgs: { id: string; name: string; role: Role }[];
}

interface Repo {
  id: string;                    // "repo_xxx"
  full_name: string;             // "owner/name"
  branch: string;
  private: boolean;
  status: "indexing" | "ready" | "failed";
  progress: { done: number; total: number };
  error: string | null;
  file_count: number;
  indexed_at: string | null;
  connected_by: string;          // user name
}

interface SourceRef { type: "jira" | "confluence" | "github" | "human" | "agent_run"; id: string; label: string; url: string | null }

interface Memory {
  memory_id: string;             // lineage id "mem_xxx"
  version: number;
  version_id: string;
  title: string;
  content: string;
  memory_type: "architecture_decision" | "bug_resolution" | "repository_convention" | "code_ownership"
             | "engineering_preference" | "workaround" | "agent_experience";
  status: "pending" | "active" | "superseded" | "invalidated" | "rejected" | "purged" | "expired";
                                 // "expired" = active but expires_at is in the past (computed)
  scope: "org" | "repo" | "team";
  team: string | null;           // when scope = "team"
  repo_id: string | null;        // when scope = "repo"
  repo_name: string | null;
  authority: "agent_observed" | "human" | "verified";
  components: string[];          // architecture component ids this applies to
  source_refs: SourceRef[];
  created_by: { id: string; name: string };
  approved_by: { id: string; name: string } | null;
  created_at: string; updated_at: string;
  expires_at: string | null;     // null = never
  retrieval_count: number;
  eligible: boolean;             // would an agent acting for the CALLER retrieve this right now
  exclusion_reason: string | null; // e.g. "pending approval", "expired", "scoped to team platform"
  history?: Memory[];            // only on GET /memories/{memory_id}; all versions, oldest first
}

interface Finding {
  kind: "commit" | "pull_request" | "issue" | "page" | "memory" | "code";
  ref: string;                   // "PR #377", "AUTH-311", "a41c9e2", "Page title", "mem_x@v2"
  title: string;
  detail: string | null;
  url: string | null;
}

interface AgentStatus {
  id: "github" | "jira" | "confluence" | "memory";
  label: string;                 // "GitHub agent" ...
  status: "pending" | "running" | "done" | "skipped" | "error";
  tools: { text: string; status: "running" | "done" | "error"; at: string }[];  // real calls it made, in order
  findings: Finding[];
  summary: string;               // one line, e.g. "3 pull requests, 2 commits" or why it was skipped
  error: string | null;
  started_at: string | null; finished_at: string | null;
}

interface Selection { path: string; start_line: number; end_line: number; text: string }

type Verdict = "proceed" | "proceed_with_constraints" | "needs_architecture_review" | "insufficient_evidence";

interface Answer {
  headline: string;
  explanation: string[];         // paragraphs, plain text (may contain `inline code`)
  guidance: {
    verdict: Verdict;            // the structured decision; this is what A/B compares
    recommendation: string;
    constraints: { text: string; memory_ref: string }[];  // memory_ref = "mem_x@v2"; every one is a real retrieved memory
    risks: string[];
  };
  evidence_refs: string[];       // refs of findings actually cited; all exist in some agent's findings
  affected_components: string[]; // component ids
  confidence: "low" | "medium" | "high";
}

interface Run {
  id: string;                    // "run_xxx"
  kind: "why" | "ask";
  status: "running" | "completed" | "failed";
  question: string;
  selection: Selection | null;
  repo_id: string | null;
  repo_name: string | null;
  memory_enabled: boolean;
  user: { id: string; name: string };
  created_at: string; finished_at: string | null;
  orchestrator: { status: "planning" | "done"; plan: ("github"|"jira"|"confluence"|"memory")[]; note: string };
  agents: AgentStatus[];         // always 4 entries, in this order: github, jira, confluence, memory
  memory: {
    retrieved: { memory_id: string; version: number; title: string; score: number; used: boolean }[];
    excluded: number;            // memories withheld by policy (tenant/team scope/status/expiry) before the model
    filter: { tenant_id: string; status: string; scopes: string[]; expires_after: string };
  };
  reasoning: { status: "pending" | "running" | "done" | "error"; model: string | null };
  answer: Answer | null;         // set when status = completed
  error: string | null;
  proposed_memory_id: string | null;  // set after propose-memory
}

interface AuditEvent {
  id: string; type: string;      // memory.created|approved|rejected|corrected|revoked|purged|retrieved|expired,
                                 // agent.run|authz.denied|auth.login|auth.register|org.member_*|integration.*|repo.*
  actor: { id: string; name: string } | null;
  memory_id: string | null; run_id: string | null;
  details: Record<string, unknown>;
  at: string;
}
```

## Auth (`/api/auth`)

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/auth/config` | – | `{ github_oauth: boolean }` (hide the GitHub button when false) |
| POST | `/auth/register` | `{ email, password (>=8), name, org_name?, invite_code? }` | `Me` + sets cookie. With `invite_code` the user joins that org with the invite's role/team; otherwise a new org is created (`org_name`, default "<name>'s workspace") and the user is its `owner`. 409 if email exists. |
| POST | `/auth/login` | `{ email, password }` | `Me` + cookie. 401 on bad credentials. |
| POST | `/auth/logout` | – | `{ ok: true }` |
| GET | `/auth/me` | – | `Me` (401 if no session) |
| POST | `/auth/switch-org` | `{ org_id }` | `Me` (403 if not a member) |
| GET | `/auth/github/login` | `?mode=login` (default) `&invite_code=` | 302 to GitHub. Browser navigation (an `<a href>`), not fetch. On return the backend signs the user in (creating an account + personal org, or joining via `invite_code`) and 302s to `/`. |
| GET | `/auth/github/connect` | – | 302 to GitHub for the signed-in user to link repo access (scope `repo read:user user:email`); returns to `/?connected=github`. |
| GET | `/auth/github/callback` | `code, state` | (GitHub redirects here) 302 to `/` or `/?auth_error=<message>`. |

## Organization (`/api/org`)

| Method | Path | Body | Returns | Needs |
|---|---|---|---|---|
| POST | `/org` | `{ name }` | `Me` (new org, caller is owner, now active) | any |
| GET | `/org/members` | – | `{ user_id, name, email, role, team }[]` | any |
| PATCH | `/org/members/{user_id}` | `{ role?, team? }` | member | `manage_members` |
| DELETE | `/org/members/{user_id}` | – | `{ ok: true }` | `manage_members` |
| GET | `/org/invites` | – | `{ code, role, team, expires_at, uses, created_by }[]` | `manage_integrations` |
| POST | `/org/invites` | `{ role: "admin"|"member", team?, expires_days? (default 7) }` | invite | `manage_integrations` |
| DELETE | `/org/invites/{code}` | – | `{ ok: true }` | `manage_integrations` |

## Integrations (`/api/integrations`)

| Method | Path | Body | Returns | Needs |
|---|---|---|---|---|
| GET | `/integrations` | – | `{ github: { connected, login, oauth_configured }, atlassian: { connected, base_url, email, jira_projects: string[], confluence_spaces: string[], status: "ok"|"error"|null, error: string|null } }` | any |
| PUT | `/integrations/atlassian` | `{ base_url ("https://x.atlassian.net"), email, api_token, jira_projects?: string[], confluence_spaces?: string[] }` | same as GET `atlassian` (validates credentials against Jira and Confluence first; 502 with reason if invalid). The token is stored encrypted and never returned. | `manage_integrations` |
| DELETE | `/integrations/atlassian` | – | `{ ok: true }` | `manage_integrations` |
| DELETE | `/integrations/github` | – | `{ ok: true }` (unlinks the caller's GitHub token) | any |

One Atlassian Cloud connection (site URL + email + API token) powers both Jira and Confluence.

## Repositories (`/api/repos`, `/api/github`)

| Method | Path | Body / query | Returns | Needs |
|---|---|---|---|---|
| GET | `/github/repos` | `?q=` | `{ connected: boolean, repos: { full_name, private, default_branch, description, updated_at }[] }` – repos the caller's GitHub token can read (empty + `connected:false` if not linked) | any |
| POST | `/repos` | `{ full_name, branch? }` | `Repo` (status `indexing`; poll `GET /repos/{id}`). Public repos work without a GitHub link; private repos need the caller's linked token. | `connect_repo` |
| GET | `/repos` | – | `Repo[]` (this org) | any |
| GET | `/repos/{id}` | – | `Repo` | any |
| POST | `/repos/{id}/reindex` | – | `Repo` | `connect_repo` |
| DELETE | `/repos/{id}` | – | `{ ok: true }` | `connect_repo` |
| GET | `/repos/{id}/tree` | – | `{ files: { path: string; size: number; language: string }[] }` | any |
| GET | `/repos/{id}/file` | `?path=` | `{ path, content, language, size, sha }` | any |
| GET | `/repos/{id}/graph` | – | `{ nodes: GraphNode[]; edges: GraphEdge[] }` | any |
| GET | `/repos/{id}/components/{node_id}` | – | `{ node: GraphNode, depends_on: {id,label,weight}[], used_by: {id,label,weight}[], recent_commits: Finding[], memories: Memory[] }` | any |

```ts
interface GraphNode { id: string; label: string; kind: "service" | "package" | "module" | "datastore" | "config";
  path: string; file_count: number; loc: number; languages: string[]; files: string[]; memory_count: number }
interface GraphEdge { from: string; to: string; weight: number; kind: "imports" }
```
The graph is derived from real import statements in the indexed files. There are no hand-placed positions; the
frontend must lay it out itself (e.g. layered by dependency depth, or a small force simulation).

## Memory (`/api/memories`)

| Method | Path | Body / query | Returns | Needs |
|---|---|---|---|---|
| GET | `/memories` | `?status=&q=&repo_id=` | `Memory[]` the caller may see (members: org + repo + own team; admin/owner: everything in the org). Never contains embeddings. | any |
| POST | `/memories` | `{ title, content, memory_type, scope, team?, repo_id?, components?: string[], source_refs?: SourceRef[], expires_in_days?: number \| null }` | `Memory`. Members create `pending`; admins/owners create directly `active`. | `propose_memory` |
| GET | `/memories/{memory_id}` | – | `Memory` with `history` | any |
| POST | `/memories/{memory_id}/approve` | `{ content?, title?, reason? }` | `Memory` (pending → active, embedded; edits are recorded) | `approve_memory` |
| POST | `/memories/{memory_id}/reject` | `{ reason }` | `Memory` | `approve_memory` |
| POST | `/memories/{memory_id}/correct` | `{ content, title?, reason }` | `Memory` (new version active + re-embedded; old → `superseded`) | `correct_memory` |
| POST | `/memories/{memory_id}/revoke` | `{ reason }` | `Memory` (`invalidated`: excluded from retrieval immediately, history kept) | `revoke_memory` |
| POST | `/memories/{memory_id}/purge` | `{ reason }` | `{ memory_id, versions_purged }` (content + embeddings physically removed, tombstone kept) | `purge_memory` |
| POST | `/memories/search` | `{ query, repo_id? }` | `{ results: { memory: Memory; score: number }[]; excluded: number }` governed `$vectorSearch` as the caller | any |

## Agent (`/api/agent`)

Runs are asynchronous. `POST` returns immediately; the client polls `GET /agent/runs/{id}` about every 600 ms
until `status !== "running"`. Each poll shows real progress: agents flip `pending → running → done`, tool calls
appear as they happen, findings fill in.

| Method | Path | Body | Returns | Needs |
|---|---|---|---|---|
| POST | `/agent/runs` | `{ kind: "why"\|"ask", question, repo_id?, selection?, memory_enabled? (default true) }` | `{ run_id }` | `ask` |
| GET | `/agent/runs/{id}` | – | `Run` (only runs in the caller's org) | any |
| GET | `/agent/runs` | `?repo_id=&limit=30` | `Run[]` newest first | any |
| POST | `/agent/runs/{id}/propose-memory` | – | `Memory` (pending, `agent_observed`, source_ref = this run; admins' proposals are still pending until approved) | `propose_memory` |
| POST | `/agent/compare` | `{ question, repo_id?, selection? }` | `{ compare_id }` | `ask` |
| GET | `/agent/compare/{id}` | – | `Compare` | any |

```ts
interface Compare {
  id: string; status: "running" | "completed" | "failed"; question: string; error: string | null;
  evidence_run_id: string | null;       // the shared evidence-gathering run both arms reuse (same repo state, same tickets/docs)
  without_memory: Answer | null;        // reasoning with NO memory in the prompt
  with_memory: Answer | null;           // reasoning with the caller's governed memories
  memories_used: { memory_id: string; version: number; title: string }[];
  changed: boolean | null;              // verdict OR constraints differ between arms
  diff: { field: string; without: string; with: string }[];  // fields that differ; empty = no change (report honestly)
}
```

## Audit (`/api/audit`)

`GET /audit?memory_id=&run_id=&type=&limit=200` → `AuditEvent[]`, newest first, tenant-scoped, requires login.
Audit events never contain memory text, so purging leaves no copy.

## Health

`GET /health` → `{ status: "ok"|"degraded", mongodb: {ok, database}, llm: {provider, model, configured}, embeddings: {provider, model, dimensions, configured}, github_oauth: boolean }`.
