"""Class-level architecture map: tree-sitter extraction, roles, labelled edges, features, Gemini naming (which can only
rename what exists), API endpoints and group maps that link a frontend repo to a backend repo."""
import pytest

from conftest import register
from app.archmap import labels as namer
from app.archmap.build import build, methods_to_verb
from app.archmap.parse import extract
from app.integrations.github import ArchiveFile, GitHubError
from app.services import repos

SPRING = {
    "api/src/main/java/x/controller/DraftController.java": '''
@RestController
@RequestMapping("/api/drafts")
public class DraftController {
    private final DraftService draftService;
    public DraftController(DraftService draftService) { this.draftService = draftService; }
    @PostMapping("/generate")
    public BlogDraft generate(@RequestBody GenerateDraftRequest req) { return draftService.generateDraft(req); }
    @GetMapping
    public List<BlogDraft> all() { return draftService.getDrafts(); }
}''',
    "api/src/main/java/x/service/DraftService.java": '''
@Service
public class DraftService {
    private final BlogDraftRepository draftRepository;
    private final DraftMapper mapper;
    private final AiClient ai;
    public DraftService(BlogDraftRepository draftRepository, DraftMapper mapper, AiClient ai) { this.draftRepository = draftRepository; this.mapper = mapper; this.ai = ai; }
    public BlogDraft generateDraft(GenerateDraftRequest req) { BlogDraft d = mapper.toEntity(req); ai.write(d); return draftRepository.save(d); }
    public List<BlogDraft> getDrafts() { return draftRepository.findAll(); }
}''',
    "api/src/main/java/x/service/AiClient.java": '''
@Service
public class AiClient {
    private static final String URL = "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent";
    public void write(BlogDraft d) { }
}''',
    "api/src/main/java/x/mapper/DraftMapper.java": '''
@Mapper(componentModel = "spring")
public interface DraftMapper { BlogDraft toEntity(GenerateDraftRequest r); }''',
    "api/src/main/java/x/repository/BlogDraftRepository.java": '''
import org.springframework.data.mongodb.repository.MongoRepository;
public interface BlogDraftRepository extends MongoRepository<BlogDraft, String> { List<BlogDraft> findByStatus(String s); }''',
    "api/src/main/java/x/model/BlogDraft.java": '''
@Document(collection = "drafts")
public class BlogDraft { private String id; private String title; }''',
    "api/src/main/java/x/dto/GenerateDraftRequest.java": "public class GenerateDraftRequest { private String topic; }",
    "api/src/main/java/x/scheduler/DigestScheduler.java": '''
@Component
public class DigestScheduler {
    private final DraftService draftService;
    public DigestScheduler(DraftService draftService) { this.draftService = draftService; }
    @Scheduled(cron = "0 0 * * * *")
    public void run() { draftService.getDrafts(); }
}''',
    "api/src/main/java/x/config/MongoConfig.java": "@Configuration\npublic class MongoConfig {}",
}
ANGULAR = {
    "web/package.json": '{"name": "web", "dependencies": {"@angular/core": "17.0.0"}}',
    "web/src/environments/environment.ts": "export const environment = { apiUrl: 'http://localhost:8080/api' };",
    "web/src/app/app.routes.ts": '''import { Routes } from '@angular/router';
import { DraftListComponent } from './components/draft-list/draft-list.component';
import { HomeComponent } from './components/home/home.component';
export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'drafts', component: DraftListComponent },
];''',
    "web/src/app/components/draft-list/draft-list.component.ts": '''import { Component } from '@angular/core';
@Component({ selector: 'app-draft-list', standalone: true, template: '<p>x</p>' })
export class DraftListComponent {
  drafts: BlogDraft[] = [];
  constructor(private draftService: DraftService, private toast: ToastService) {}
  load() { this.draftService.getDrafts().subscribe(d => this.toast.show('ok')); }
}''',
    "web/src/app/components/home/home.component.ts": '''import { Component } from '@angular/core';
@Component({ selector: 'app-home', standalone: true, template: '<p>home</p>' })
export class HomeComponent {}''',
    "web/src/app/services/draft.service.ts": '''import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
@Injectable({ providedIn: 'root' })
export class DraftService {
  private apiUrl = `${environment.apiUrl}/drafts`;
  constructor(private http: HttpClient) {}
  getDrafts() { return this.http.get<BlogDraft[]>(this.apiUrl); }
  generate(r: GenerateDraftRequest) { return this.http.post<BlogDraft>(`${this.apiUrl}/generate`, r); }
}''',
    "web/src/app/shared/toast.service.ts": '''import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class ToastService { show(m: string) {} }''',
    "web/src/app/models/blog-draft.model.ts": "export interface BlogDraft { id: string; title: string }\nexport interface GenerateDraftRequest { topic: string }",
}


def by_name(m):
    return {n["name"]: n for n in m["nodes"]}


def edge(m, a, b):
    names = {n["id"]: n["name"] for n in m["nodes"]}
    hits = [e for e in m["edges"] if names.get(e["from"]) == a and names.get(e["to"]) == b]
    return hits[0] if hits else None


# ------------------------------------------------------------------ extraction
def test_tree_sitter_reads_annotations_bases_injection_and_calls():
    syms = {s.name: s for s in extract("x/DraftService.java", SPRING["api/src/main/java/x/service/DraftService.java"])}
    s = syms["DraftService"]
    assert s.annotations == ["Service"]
    assert s.deps["draftRepository"] == "BlogDraftRepository" and s.deps["mapper"] == "DraftMapper"
    assert ("draftRepository", "save") in s.calls and ("draftRepository", "findAll") in s.calls
    repo = extract("r.java", SPRING["api/src/main/java/x/repository/BlogDraftRepository.java"])[0]
    assert repo.kind == "interface" and "MongoRepository" in repo.bases and "BlogDraft" in repo.bases
    ng = {s.name: s for s in extract("a.ts", ANGULAR["web/src/app/components/draft-list/draft-list.component.ts"])}
    assert ng["DraftListComponent"].annotations == ["Component"] and ng["DraftListComponent"].deps["draftService"] == "DraftService"


def test_methods_become_plain_verbs():
    assert methods_to_verb(["findByStatus", "save"]) == "reads & saves"
    assert methods_to_verb(["deleteById", "findAll", "saveAll"]) == "reads, saves & deletes"
    assert methods_to_verb(["toString"]) is None


# ------------------------------------------------------------------ Spring + Angular map
def test_spring_layers_are_linked_controller_service_repository_entity():
    m = build({**SPRING, **ANGULAR})
    n = by_name(m)
    roles = {k: v["role"] for k, v in n.items()}
    assert roles["DraftController"] == "endpoint" and roles["DigestScheduler"] == "job" and roles["DraftMapper"] == "mapper"
    assert roles["BlogDraftRepository"] == "repository" and roles["BlogDraft"] == "entity"
    assert "GenerateDraftRequest" not in n and "MongoConfig" not in n            # DTOs and config are tags/hidden, not boxes
    assert n["DraftController"]["tags"] == ["GenerateDraftRequest"]
    assert edge(m, "DraftController", "DraftService")["label"] == "delegates to"
    assert edge(m, "DraftService", "BlogDraftRepository")["label"] == "reads & saves"
    assert edge(m, "DraftService", "DraftMapper")["label"] == "maps with"
    assert edge(m, "BlogDraftRepository", "BlogDraft")["label"] == "stores"
    assert edge(m, "DigestScheduler", "DraftService")["label"] == "runs"
    assert n["BlogDraft"]["store"] == "MongoDB" and "0 0 * * * *" in n["DigestScheduler"]["schedule"]
    gem = edge(m, "AiClient", "Gemini API")
    assert gem and gem["label"] == "sends prompts to"


def test_angular_screens_clients_and_http_to_the_spring_controller():
    m = build({**SPRING, **ANGULAR})
    n = by_name(m)
    assert n["DraftListComponent"]["role"] == "page" and n["DraftListComponent"]["ui_route"] == "/drafts"
    # the frontend DraftService (TypeScript) is the API client; the Java one stays the backend service
    fe = [x for x in m["nodes"] if x["name"] == "DraftService" and x["tier"] == "frontend"][0]
    assert fe["role"] == "client"
    names = {x["id"]: x for x in m["nodes"]}
    http = [e for e in m["edges"] if e["kind"] == "http"]
    assert len(http) == 1 and names[http[0]["from"]]["tier"] == "frontend" and names[http[0]["to"]]["name"] == "DraftController"
    assert http[0]["label"] == "HTTP GET, POST /api/drafts" and http[0]["evidence"][0]["call_line"] > 0
    assert edge(m, "app.routes", "DraftListComponent")["label"] == "routes to /drafts"
    assert "ToastService" not in n                                                # UI helper without API calls: hidden
    feats = {f["id"]: f for f in m["features"]}
    assert set(feats) >= {"web", "draft", "data", "external"}
    assert names[http[0]["to"]]["feature"] == "draft" and n["BlogDraftRepository"]["feature"] == "data"
    assert n["DigestScheduler"]["feature"] == "draft"                             # a job joins the feature it runs
    actor = names["actor:user"]
    assert any(e["from"] == actor["id"] and names[e["to"]]["role"] == "router" for e in m["edges"])


def test_one_arrow_per_pair_and_a_stable_fingerprint():
    m1, m2 = build({**SPRING, **ANGULAR}), build({**SPRING, **ANGULAR})
    pairs = [(e["from"], e["to"]) for e in m1["edges"]]
    assert len(pairs) == len(set(pairs)) and m1["fingerprint"] == m2["fingerprint"]


# ------------------------------------------------------------------ FastAPI + React
PY_REACT = {
    "backend/app/api/notes.py": '''from fastapi import APIRouter
from app.services import notes_service
router = APIRouter(prefix="/notes")

@router.get("")
def list_notes():
    return notes_service.list_all()

@router.post("")
def create(body: NoteIn):
    return notes_service.create(body)
''',
    "backend/app/services/notes_service.py": '''from app import db
def list_all():
    return list(db.notes().find())
def create(body):
    return db.notes().insert_one(body.dict())
''',
    "backend/app/db.py": '''from pymongo import MongoClient
_client = MongoClient("mongodb://localhost")
def notes():
    return _client.app.notes
''',
    "backend/app/schemas.py": "from pydantic import BaseModel\nclass NoteIn(BaseModel):\n    text: str\n",
    "web/package.json": '{"dependencies": {"react": "18.0.0", "next": "14.0.0"}}',
    "web/app/notes/page.tsx": '''import { listNotes } from "../../lib/api";
export default function NotesPage() { const n = listNotes(); return <ul>{n}</ul>; }''',
    "web/lib/api.ts": '''export const listNotes = () => fetch("/api/notes").then(r => r.json());
export const addNote = (t: string) => fetch("/api/notes", { method: "POST", body: t });''',
}


def test_fastapi_and_react_without_classes_still_get_layers():
    m = build(PY_REACT)
    n = by_name(m)
    assert n["notes"]["role"] == "endpoint" and n["notes_service"]["role"] == "service" and n["db"]["role"] == "repository"
    assert n["notes/page"]["role"] == "page" and n["notes/page"]["ui_route"] == "/notes" and n["api"]["role"] == "client"
    assert edge(m, "notes", "notes_service")["label"] == "delegates to"
    assert edge(m, "notes_service", "db")
    assert edge(m, "db", "MongoDB")["label"] == "reads & saves"
    assert edge(m, "api", "notes")["kind"] == "http"
    assert "NoteIn" not in n and n["notes"]["tags"] == ["NoteIn"]


# ------------------------------------------------------------------ Gemini naming can only rename
class FakeLabelsLLM:
    model_name = "fake-gemini"

    def __init__(self):
        self.prompts = []

    def structured(self, system, prompt, schema):
        self.prompts.append(prompt)
        import json
        body = json.loads(prompt.split("<map>")[1].split("</map>")[0])
        boxes = [b for f in body["features"] for b in f["boxes"]]
        return schema(actor="Editor", summary="A blog engine.",
                      features=[namer.FeatureLabel(id=f["id"], name=f"{f['current_name']} area", description="does things") for f in body["features"]]
                      + [namer.FeatureLabel(id="invented", name="Ghost", description="x")],
                      nodes=[namer.NodeLabel(id=b["id"], label=f"Nice {b['name']}", description="a box") for b in boxes]
                      + [namer.NodeLabel(id="n999", label="Ghost box", description="x")])


def test_labels_rename_existing_parts_only(monkeypatch):
    from app.agents import llm as llm_mod
    fake = FakeLabelsLLM()
    monkeypatch.setattr(llm_mod, "_llm", fake)
    m = build({**SPRING, **ANGULAR})
    lab = namer.generate(m, ["acme/blog"])
    assert "invented" not in lab["features"] and all(k in {n["id"] for n in m["nodes"]} for k in lab["nodes"])
    out = namer.apply(m, lab)
    assert len(out["nodes"]) == len(m["nodes"]) and len(out["edges"]) == len(m["edges"])
    assert by_name(out)["DraftController"]["label"] == "Nice DraftController" and by_name(out)["User"]["label"] == "Editor"
    assert "GenerateDraftRequest" in fake.prompts[0]  # data types are given to the model as context


# ------------------------------------------------------------------ API and group maps
class FakeGitHub:
    authenticated = True

    def __init__(self, token=None):
        pass

    def repo(self, full_name):
        return {"full_name": full_name, "private": False, "default_branch": "main", "description": "", "updated_at": None}

    def tree(self, *a):
        raise GitHubError("archive path", 429)

    def archive(self, full_name, ref, max_bytes):
        files = SPRING if full_name == "acme/api" else ANGULAR
        for p, c in files.items():
            yield ArchiveFile(p, c.encode())

    def file_history(self, *a, **k):
        return []


@pytest.fixture
def world(client, monkeypatch):
    for t in ("app.services.repos.get_github_client", "app.api.repos.get_github_client", "app.api.groups.get_github_client"):
        monkeypatch.setattr(t, FakeGitHub)
    original = repos.index_repo
    monkeypatch.setattr(repos, "start_index", lambda rid, token, background=True: original(rid, token))
    from app.agents import llm as llm_mod
    monkeypatch.setattr(llm_mod, "_llm", FakeLabelsLLM())
    register(client, "o@x.io", "Olive", org_name="Acme")
    ids = {n: client.post("/api/repos", json={"full_name": n}).json()["id"] for n in ("acme/api", "acme/web")}
    return {"c": client, "ids": ids}


def test_archmap_endpoint_and_cached_gemini_labels(world, env):
    c, rid = world["c"], world["ids"]["acme/api"]
    m = c.get(f"/api/repos/{rid}/archmap").json()
    assert m["labels_status"] == "missing" and "http" not in m and any(n["role"] == "endpoint" for n in m["nodes"])
    named = c.post(f"/api/repos/{rid}/archmap/labels").json()
    assert named["labels_status"] == "ready" and named["labels"]["model"] == "fake-gemini"
    again = c.get(f"/api/repos/{rid}/archmap").json()
    assert again["labels_status"] == "ready" and by_name(again)["DraftController"]["label"] == "Nice DraftController"


def test_group_map_links_the_web_repo_to_the_api_repo(world):
    c, ids = world["c"], world["ids"]
    g = c.post("/api/groups", json={"name": "Blog", "repo_ids": [ids["acme/web"], ids["acme/api"]]}).json()
    m = c.get(f"/api/groups/{g['id']}/archmap").json()
    nodes = {n["id"]: n for n in m["nodes"]}
    cross = [e for e in m["edges"] if e.get("cross_repo")]
    assert len(cross) == 1 and nodes[cross[0]["from"]]["repo_name"] == "acme/web" and nodes[cross[0]["to"]]["name"] == "DraftController"
    assert cross[0]["evidence"][0]["call_repo"] == "acme/web" and cross[0]["evidence"][0]["route_repo"] == "acme/api"
    assert len([n for n in m["nodes"] if n["role"] == "actor"]) == 1
    assert {f.get("repo_name") for f in m["features"] if f["id"] != "external"} == {"acme/web", "acme/api"}
    other = c.post("/api/groups", json={"name": "Solo"}).json()
    assert c.get(f"/api/groups/{other['id']}/archmap").json()["nodes"] == []
