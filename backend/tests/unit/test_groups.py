"""Repo groups: interface extraction, cross-repo linking with evidence, group CRUD and org isolation, the group memory scope,
and the agent searching every repository of a group."""
import pytest

from conftest import principal_for, register
from app import code, interfaces as I
from app.agents import pipeline
from app.db import get_db
from app.integrations.github import ArchiveFile, GitHubError
from app.services import repos

ORIGINAL_INDEX = repos.index_repo

REPOS = {
    "acme/notes-web": {
        "package.json": '{"name": "notes-web", "dependencies": {"@acme/notes-shared": "1.0.0"}}',
        "src/lib/api.ts": ('import { Note } from "@acme/notes-shared";\n'
                           "const BASE = process.env.NEXT_PUBLIC_API;\n"
                           "export const listNotes = () => fetch(`${BASE}/notes`);\n"
                           'export const deleteNote = (id: string) => fetch(`${BASE}/notes/${id}`, { method: "DELETE" });\n'
                           'export const createNote = (n: Note) => axios.post("/api/notes", n);\n'
                           'export const me = () => get<User>("/auth/me");\n'
                           'export const weather = () => fetch("https://api.weather.example/v1/today");\n'),
        "src/app/page.tsx": 'import { listNotes } from "../lib/api";\nexport default function Page() { return null; }\n',
        "src/lib/api.test.ts": 'fetch("/notes/should-not-count");\n',
    },
    "acme/notes-api": {
        "pyproject.toml": '[project]\nname = "notes-api"\n',
        "app/main.py": "from fastapi import FastAPI\nfrom app.routes import notes, auth\napp = FastAPI()\n",
        "app/routes/notes.py": ('from fastapi import APIRouter\nrouter = APIRouter(prefix="/notes")\n\n'
                                '@router.get("")\ndef list_notes(): ...\n\n'
                                '@router.post("")\ndef create_note(): ...\n\n'
                                '@router.delete("/{note_id}")\ndef delete_note(note_id: str): ...\n'),
        "app/routes/auth.py": 'from flask import Blueprint\nbp = Blueprint("auth", __name__, url_prefix="/auth")\n\n@bp.route("/me", methods=["GET"])\ndef me(): ...\n',
    },
    "acme/notes-shared": {
        "package.json": '{"name": "@acme/notes-shared"}',
        "src/index.ts": "export type Note = { id: string; body: string };\n",
    },
    "acme/other": {"main.go": 'package main\nfunc main() { http.HandleFunc("/ping", ping) }\n'},
}


class FakeGitHub:
    authenticated = True

    def __init__(self, token=None):
        pass

    def repo(self, full_name):
        return {"full_name": full_name, "private": False, "default_branch": "main", "description": "", "updated_at": None}

    def tree(self, full_name, ref):
        raise GitHubError("use the archive path", 429)

    def archive(self, full_name, ref, max_bytes):
        for path, text in REPOS[full_name].items():
            yield ArchiveFile(path, text.encode())

    def blame(self, *a, **k):
        return []

    def file_history(self, *a, **k):
        return []

    def commit_pulls(self, *a, **k):
        return []


@pytest.fixture
def world(client, make_client, monkeypatch):
    for target in ("app.agents.pipeline.get_github_client", "app.services.repos.get_github_client", "app.api.groups.get_github_client",
                   "app.api.repos.get_github_client"):
        monkeypatch.setattr(target, FakeGitHub)
    monkeypatch.setattr(repos, "start_index", lambda rid, token, background=True: ORIGINAL_INDEX(rid, token))
    register(client, "owner@x.io", "Olive", org_name="Acme")
    inv = client.post("/api/org/invites", json={"role": "member"}).json()
    member = make_client()
    register(member, "m@x.io", "Mia", invite_code=inv["code"])
    ids = {}
    for name in ("acme/notes-web", "acme/notes-api", "acme/notes-shared", "acme/other"):
        r = client.post("/api/repos", json={"full_name": name})
        assert r.status_code == 200, r.text
        ids[name] = r.json()["id"]
    return {"owner": client, "member": member, "ids": ids, "owner_p": principal_for(client), "member_p": principal_for(member)}


def make_group(w, *names, name="Notes App"):
    r = w["owner"].post("/api/groups", json={"name": name, "description": "web + api", "repo_ids": [w["ids"][n] for n in names]})
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ extraction (pure functions)
def test_norm_path_turns_params_and_bases_into_placeholders():
    assert I.norm_path("${BASE}/notes/${id}?x=1") == "/notes/{}"
    assert I.norm_path("https://api.example.com/v1/users/:id") == "/v1/users/{}"
    assert I.norm_path("/items/<int:item_id>/") == "/items/{}"
    assert I.norm_path("{settings.API}/x/{x_id}") == "/x/{}"
    assert I.norm_path("notes") is None


def test_routes_for_each_framework():
    fastapi = I.extract_routes("a.py", 'r = APIRouter(prefix="/v1")\n@r.get("/items/{id}")\ndef f(): ...\n@r.api_route("/any")\ndef g(): ...', "python")
    assert [(x["method"], x["path"]) for x in fastapi] == [("GET", "/v1/items/{}"), ("*", "/v1/any")]
    express = I.extract_routes("s.js", 'router.post("/users/:id", auth, handler);\napi.get("/client-call", { params });', "javascript")
    assert [(x["method"], x["path"]) for x in express] == [("POST", "/users/{}")]
    nxt = I.extract_routes("web/app/api/notes/[id]/route.ts", "export async function GET() {}\nexport async function DELETE() {}", "typescript")
    assert {(x["method"], x["path"]) for x in nxt} == {("GET", "/api/notes/{}"), ("DELETE", "/api/notes/{}")}
    go = I.extract_routes("main.go", 'mux.HandleFunc("POST /orders/{id}", h)\nr.Get("/health", h)', "go")
    assert [(x["method"], x["path"]) for x in go] == [("POST", "/orders/{}"), ("GET", "/health")]
    spring = I.extract_routes("C.java", '@RequestMapping("/api/users")\npublic class C {\n @GetMapping("/{id}")\n User get() {}\n @PostMapping\n void add() {}\n}', "java")
    assert [(x["method"], x["path"]) for x in spring] == [("GET", "/api/users/{}"), ("POST", "/api/users")]


def test_calls_read_method_from_their_own_options_and_skip_tests_and_route_definitions():
    src = 'fetch(`${B}/a`);\nfetch(`${B}/b`, { method: "PUT", headers: { x: 1 } });\nrouter.get("/c", (req, res) => 1);\nclient.delete(`/d/${id}`);'
    calls = I.extract_calls("x.ts", src, "typescript", I.route_positions(src, "typescript"))
    assert [(c["method"], c["path"]) for c in calls] == [("GET", "/a"), ("PUT", "/b"), ("DELETE", "/d/{}")]
    assert I.extract_calls("x.test.ts", src, "typescript") == []
    py = I.extract_calls("c.py", 'requests.post(f"{BASE}/orders/{oid}/pay")\nos.environ.get("/not-a-call")', "python")
    assert [(c["method"], c["path"]) for c in py] == [("POST", "/orders/{}/pay")]


def test_path_matching_is_prefix_tolerant_but_needs_a_literal_overlap():
    assert I.path_score("/notes/{}", "/notes/{}") == 1.0
    assert I.path_score("/api/notes", "/notes") == 0.8          # prefix mounted elsewhere (include_router / app.use)
    assert I.path_score("/notes", "/api/v1/notes") == 0.7       # base URL kept in config
    assert I.path_score("/x/notes", "/a/b/c/notes") == 0.0      # too far apart
    assert I.path_score("/{}", "/notes") == 0.0                 # parameters alone never match
    links, unmatched = I.link_calls([{"method": "GET", "path": "/api/notes"}, {"method": "POST", "path": "/health"}],
                                    [{"method": "GET", "path": "/notes"}, {"method": "GET", "path": "/health"}])
    assert len(links) == 1 and unmatched == [{"method": "POST", "path": "/health"}]   # method must agree


def test_single_repo_graph_gets_api_edges_between_its_own_components():
    files = {**{f"web/{k}": v for k, v in REPOS["acme/notes-web"].items()}, **{f"api/{k}": v for k, v in REPOS["acme/notes-api"].items()}}
    g = code.build_graph(files)
    api = [e for e in g["edges"] if e["kind"] == "calls_api"]
    assert len(api) == 1 and api[0]["from"] == "web" and api[0]["to"] == "api"
    assert {(x["method"], x["path"]) for x in api[0]["endpoints"]} == {("GET", "/notes"), ("DELETE", "/notes/{}"), ("POST", "/notes"), ("GET", "/auth/me")}
    assert all(ev["call_file"].startswith("web/") and ev["route_file"].startswith("api/") for ev in api[0]["evidence"])


# ------------------------------------------------------------------ groups over the API
def test_group_map_links_frontend_and_backend_repos_with_evidence(world):
    g = make_group(world, "acme/notes-web", "acme/notes-api", "acme/notes-shared")
    assert [r["full_name"] for r in g["repos"]] == ["acme/notes-web", "acme/notes-api", "acme/notes-shared"]
    graph = world["member"].get(f"/api/groups/{g['id']}/graph").json()
    web, api, shared = (world["ids"][n] for n in ("acme/notes-web", "acme/notes-api", "acme/notes-shared"))
    assert {n["repo_id"] for n in graph["nodes"]} == {web, api, shared}
    cross = [e for e in graph["edges"] if e["cross_repo"]]
    calls = [e for e in cross if e["kind"] == "calls_api"]
    assert len(calls) == 1 and calls[0]["from"] == f"{web}:src" and calls[0]["to"] == f"{api}:app"
    assert {(x["method"], x["path"]) for x in calls[0]["endpoints"]} == {("GET", "/notes"), ("DELETE", "/notes/{}"), ("POST", "/notes"), ("GET", "/auth/me")}
    ev = calls[0]["evidence"][0]
    assert ev["call_repo"] == "acme/notes-web" and ev["route_repo"] == "acme/notes-api" and ev["call_line"] > 0 and ev["route_line"] > 0
    pkgs = [e for e in cross if e["kind"] == "depends_on_package"]
    assert len(pkgs) == 1 and pkgs[0]["from"] == f"{web}:src" and pkgs[0]["to"] == f"{shared}:~root" and pkgs[0]["packages"] == ["@acme/notes-shared"]
    unmatched = {(c["method"], c["path"]) for c in graph["unmatched_calls"]}
    assert ("GET", "/v1/today") in unmatched and not any("should-not-count" in c["raw"] for c in graph["unmatched_calls"])

    comp = world["member"].get(f"/api/groups/{g['id']}/components/{api}:app").json()
    assert comp["used_by"][0]["repo_name"] == "acme/notes-web" and comp["used_by"][0]["kind"] == "calls_api"
    assert {(r["method"], r["path"]) for r in comp["serves"]} >= {("GET", "/notes"), ("DELETE", "/notes/{}")}
    tree = world["member"].get(f"/api/groups/{g['id']}/tree").json()["files"]
    assert {f["repo_name"] for f in tree} == {"acme/notes-web", "acme/notes-api", "acme/notes-shared"}


def test_group_crud_permissions_and_membership_changes(world):
    assert world["member"].post("/api/groups", json={"name": "Nope"}).status_code == 403
    g = make_group(world, "acme/notes-web")
    assert world["owner"].post("/api/groups", json={"name": "Notes App"}).status_code == 409
    r = world["owner"].patch(f"/api/groups/{g['id']}", json={"name": "Notes", "repo_ids": [world["ids"]["acme/notes-web"], world["ids"]["acme/notes-api"]]})
    assert r.status_code == 200 and r.json()["name"] == "Notes" and len(r.json()["repos"]) == 2
    # removing a repo from the org removes it from its groups
    assert world["owner"].delete(f"/api/repos/{world['ids']['acme/notes-api']}").status_code == 200
    assert [x["full_name"] for x in world["owner"].get(f"/api/groups/{g['id']}").json()["repos"]] == ["acme/notes-web"]
    assert world["owner"].delete(f"/api/groups/{g['id']}").status_code == 200
    assert world["owner"].get("/api/groups").json() == []
    types = [e["type"] for e in world["owner"].get("/api/audit").json()]
    assert {"group.created", "group.updated", "group.deleted"} <= set(types)


def test_other_orgs_can_neither_see_groups_nor_add_foreign_repos(world, make_client):
    g = make_group(world, "acme/notes-web", "acme/notes-api")
    eve = make_client()
    register(eve, "e@y.io", "Eve", org_name="Evil")
    assert eve.get(f"/api/groups/{g['id']}").status_code == 404
    assert eve.get(f"/api/groups/{g['id']}/graph").status_code == 404
    assert eve.get("/api/groups").json() == []
    assert eve.post("/api/groups", json={"name": "Steal", "repo_ids": [world["ids"]["acme/notes-web"]]}).status_code == 422
    assert eve.post("/api/agent/runs", json={"kind": "ask", "question": "notes", "group_id": g["id"]}).status_code == 404


# ------------------------------------------------------------------ group memory scope
def mem(w, title, **kw):
    r = w["owner"].post("/api/memories", json={"title": title, "content": f"{title}. Notes are deleted softly.", "memory_type": "architecture_decision", **kw})
    assert r.status_code == 200, r.text
    return r.json()["memory_id"]


def test_group_scope_memories_are_only_retrieved_inside_their_group(world):
    g = make_group(world, "acme/notes-web", "acme/notes-api")
    other = make_group(world, "acme/other", name="Other")
    in_group = mem(world, "Web talks to API only through the notes client", scope="group", group_id=g["id"])
    member_repo = mem(world, "API notes deletion is soft delete", scope="repo", repo_id=world["ids"]["acme/notes-api"])
    outsider = mem(world, "Other service notes ping contract", scope="repo", repo_id=world["ids"]["acme/other"])
    q = "notes deleted softly"

    def found(**ctx):
        r = world["member"].post("/api/memories/search", json={"query": q, **ctx}).json()
        return {x["memory"]["memory_id"] for x in r["results"]}

    assert found(group_id=g["id"]) >= {in_group, member_repo} and outsider not in found(group_id=g["id"])
    assert in_group not in found(repo_id=world["ids"]["acme/notes-api"])     # a single-repo workspace is not the group
    assert in_group not in found(group_id=other["id"]) and in_group not in found()
    listing = {m["memory_id"]: m for m in world["member"].get("/api/memories", params={"group_id": other["id"]}).json()}
    assert in_group not in listing and outsider in listing
    detail = world["member"].get(f"/api/memories/{in_group}").json()
    assert detail["scope"] == "group" and detail["group_name"] == "Notes App"
    bad = world["owner"].post("/api/memories", json={"title": "x", "content": "y", "memory_type": "workaround", "scope": "group", "group_id": "grp_nope"})
    assert bad.status_code == 422


def test_renaming_a_group_relabels_its_memories(world):
    g = make_group(world, "acme/notes-web")
    mid = mem(world, "Group rule", scope="group", group_id=g["id"])
    world["owner"].patch(f"/api/groups/{g['id']}", json={"name": "Notes Platform"})
    assert world["owner"].get(f"/api/memories/{mid}").json()["group_name"] == "Notes Platform"


# ------------------------------------------------------------------ the agent in a group workspace
def test_agent_searches_code_across_every_repo_of_the_group_and_proposes_group_memory(world):
    g = make_group(world, "acme/notes-web", "acme/notes-api")
    gm = mem(world, "Deleting notes goes through the API soft delete", scope="group", group_id=g["id"])
    rid = pipeline.start_run(world["member_p"], kind="ask", question="How are notes deleted?", group_id=g["id"], background=False)
    run = pipeline.run_api(get_db().agent_runs.find_one({"_id": rid}))
    assert run["status"] == "completed" and run["group_name"] == "Notes App"
    gh = next(a for a in run["agents"] if a["id"] == "github")
    assert "across 2 repositories" in gh["tools"][0]["text"]
    refs = {f["ref"] for f in gh["findings"] if f["kind"] == "code"}
    assert any(r.startswith("acme/notes-web:") for r in refs) and any(r.startswith("acme/notes-api:") for r in refs)
    assert gm in {m["memory_id"] for m in run["memory"]["retrieved"]}
    assert "group:Notes App" in run["memory"]["filter"]["scopes"]
    proposed = world["member"].post(f"/api/agent/runs/{rid}/propose-memory").json()
    assert proposed["scope"] == "group" and proposed["group_id"] == g["id"] and proposed["status"] == "pending"


def test_group_agents_use_public_sources_of_member_repositories_only(world, monkeypatch):
    from app.integrations.public_atlassian import parse_source
    from app.services import integrations

    g = make_group(world, "acme/notes-web", "acme/notes-api")
    p = world["owner_p"]
    for name, project in (("acme/notes-web", "WEB"), ("acme/notes-api", "API"), ("acme/other", "OTHER")):
        source = {**parse_source(f"https://issues.example.org/projects/{project}"), "title": project, "access": "public", "search_available": True}
        integrations.save_public_source(p.org_id, p.user_id, source, world["ids"][name])
    queried = []

    class PublicJira:
        def __init__(self, source):
            self.source, self.base = source, source["base_url"]

        def jira_search(self, *a, **k):
            project = self.source["project"]
            queried.append(project)
            return [{"key": f"{project}-1", "summary": "Notes decision", "description": "Use the notes API", "url": f"{self.base}/browse/{project}-1"}]

    monkeypatch.setattr(pipeline, "get_public_atlassian", PublicJira)
    rid = pipeline.start_run(world["member_p"], kind="ask", question="How are notes deleted?", group_id=g["id"], memory_enabled=False, background=False)
    run = get_db().agent_runs.find_one({"_id": rid})
    assert run["status"] == "completed" and set(queried) == {"WEB", "API"}
    assert {f["ref"] for f in run["agents"]["jira"]["findings"]} == {"WEB-1", "API-1"}


def test_a_selection_in_a_group_must_name_a_member_repo(world):
    g = make_group(world, "acme/notes-web")
    sel = {"path": "src/lib/api.ts", "start_line": 3, "end_line": 3, "text": "fetch"}
    r = world["member"].post("/api/agent/runs", json={"kind": "why", "group_id": g["id"], "selection": sel})
    assert r.status_code == 422
    r = world["member"].post("/api/agent/runs", json={"kind": "why", "group_id": g["id"], "selection": {**sel, "repo_id": world["ids"]["acme/other"]}})
    assert r.status_code == 422


def test_angular_style_url_variables_resolve_through_environment_files():
    files = {
        "web/src/environments/environment.ts": "export const environment = {\n  apiUrl: 'http://localhost:8080/api'\n};",
        "web/src/environments/environment.prod.ts": "export const environment = {\n  apiUrl: 'https://prod.example.com/api'\n};",
        "web/src/app/services/draft.service.ts": ("import { environment } from '../../environments/environment';\n"
                                                  "export class DraftService {\n  private apiUrl = `${environment.apiUrl}/drafts`;\n"
                                                  "  list() { return this.http.get<Draft[]>(this.apiUrl, { params }); }\n"
                                                  "  one(id: string) { return this.http.get<Draft>(`${this.apiUrl}/${id}`); }\n"
                                                  "  status(id: string, r: R) { return this.http.patch<Draft>(`${this.apiUrl}/${id}/status`, r); }\n}"),
        "api/src/main/java/x/DraftController.java": ('@RestController\n@RequestMapping("/api/drafts")\npublic class DraftController {\n'
                                                     '  @GetMapping\n  public List<D> all() {}\n  @GetMapping("/{id}")\n  public D one() {}\n'
                                                     '  @PatchMapping("/{id}/status")\n  public D status() {}\n}'),
    }
    g = code.build_graph(files)
    assert {(c["method"], c["path"]) for c in g["interfaces"]["calls"]} == {("GET", "/api/drafts"), ("GET", "/api/drafts/{}"), ("PATCH", "/api/drafts/{}/status")}
    links, unmatched = I.link_calls(g["interfaces"]["calls"], g["interfaces"]["routes"])
    assert unmatched == [] and all(s == 1.0 for *_, s in links)


def test_ambiguous_config_values_stay_unresolved():
    files = {"a/config.ts": "export const base = '/v1';", "b/config.ts": "export const base = '/v2';"}
    assert "base" not in I.config_urls(files)
