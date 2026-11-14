"""Build the architecture map of one repository from its indexed files.

Output (stored in repo_graphs.archmap, JSON-serialisable):
  nodes:    one per visible symbol (screen, API client, endpoint, job, service, mapper, repository, entity) plus external
            systems, databases and the user. Each keeps file + line, role, tier (frontend/backend), feature, and tags (the
            DTOs it uses). Hidden symbols (DTOs, configs, utils) are counted, not drawn.
  edges:    labelled from code facts: "delegates to", "reads & saves" (from repository methods actually called),
            "HTTP GET, POST /api/drafts" (matched calls/routes), "routes to /drafts", "sends prompts to" ...
  features: groups of nodes (one per backend endpoint family, a shared data layer, one web-app group, externals).

Every box and arrow comes from the code. Gemini only renames features/boxes and adds one-line descriptions (labels.py)."""
from __future__ import annotations

import hashlib
import json
import posixpath
import re
from collections import Counter, defaultdict

from app import code, interfaces
from app.archmap import externals as ext
from app.archmap.parse import Symbol, extract
from app.archmap.roles import LAYER, VISIBLE, classify

VERSION = 1
SCRIPT_PATH = re.compile(r"(^|/)(scripts?|migrations?|alembic|tools|bin|fixtures|seeds?|examples?|docs?)(/|$)")
MAX_NODES = 400
FRONTEND_FRAMEWORKS = re.compile(r'"(react|react-dom|@angular/core|vue|next|svelte|@sveltejs/kit|nuxt|solid-js|preact|@remix-run/react|astro)"\s*:')
ROLE_WORDS = {"controller", "service", "repository", "repo", "dao", "dto", "request", "response", "mapper", "entity", "model", "component",
              "page", "screen", "view", "client", "api", "impl", "manager", "scheduler", "job", "task", "handler", "router", "routes", "route",
              "store", "hook", "use", "provider", "resource", "endpoint", "list", "editor", "detail", "details", "form", "item", "card",
              "default", "base", "abstract", "rest", "web", "http", "config", "module", "index", "main", "app", "feed", "manager", "post", "feature"}


# ------------------------------------------------------------------ helpers
def tokens(name: str) -> list[str]:
    """DraftEditorComponent -> [draft, editor, component]; draft-list.component -> [draft, list, component]"""
    name = name.split("/")[-1]
    parts = re.findall(r"[A-Z]+(?=[A-Z][a-z]|\b|[0-9_.-])|[A-Z]?[a-z]+|[0-9]+", re.sub(r"[._-]", " ", name))
    return [p.lower() for p in parts if p]


def singular(w: str) -> str:
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is", "news", "stats")):
        return w[:-1]
    return w


def domain_tokens(name: str) -> list[str]:
    return [singular(t) for t in tokens(name) if t not in ROLE_WORDS and len(t) > 1]


def frontend_roots(files: dict[str, str]) -> list[str]:
    roots = []
    for p, c in files.items():
        if p.endswith("package.json") and FRONTEND_FRAMEWORKS.search(c):
            roots.append(posixpath.dirname(p))
    return roots


def is_frontend(path: str, roots: list[str], sym: Symbol | None = None) -> bool:
    if not (path.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte"))):
        return False
    if any(path == r or path.startswith(r + "/") if r else True for r in roots) and roots:
        return not re.search(r"(^|/)(server|api|backend|functions)(/|$)", path) or bool(sym and sym.jsx)
    return path.endswith((".tsx", ".jsx")) or bool(sym and (sym.jsx or "Component" in sym.annotations))


def methods_to_verb(methods: list[str]) -> str | None:
    verbs = []
    for m in methods:
        ml = m.lower()
        if re.match(r"(find|get|read|load|count|exists|search|list|query|select|fetch|stream|aggregate|retrieve)", ml):
            verbs.append("reads")
        elif re.match(r"(save|insert|create|update|upsert|put|persist|add|set|mark|increment|merge|replace|store|write)", ml):
            verbs.append("saves")
        elif re.match(r"(delete|remove|purge|clear|drop|unset)", ml):
            verbs.append("deletes")
    vs = list(dict.fromkeys(v for v in ("reads", "saves", "deletes") if v in verbs))
    if not vs:
        return None
    return vs[0] if len(vs) == 1 else ", ".join(vs[:-1]) + " & " + vs[-1]


def common_path(paths: list[str]) -> str:
    segs = [p.strip("/").split("/") for p in paths]
    out = []
    for parts in zip(*segs):
        if len(set(parts)) == 1 and parts[0] != "{}":
            out.append(parts[0])
        else:
            break
    return "/" + "/".join(out) if out else "/"


def http_label(endpoints: list[tuple[str, str]]) -> str:
    methods = sorted({m for m, _ in endpoints if m != "*"}, key=["GET", "POST", "PUT", "PATCH", "DELETE"].index if True else None) \
        if all(m in ("GET", "POST", "PUT", "PATCH", "DELETE", "*") for m, _ in endpoints) else sorted({m for m, _ in endpoints})
    paths = [p for _, p in endpoints]
    where = paths[0] if len(set(paths)) == 1 else common_path(paths)
    if where == "/":  # nothing in common: name the top-level resources instead
        tops = list(dict.fromkeys("/" + p.strip("/").split("/")[0] for p in paths))
        where = ", ".join(tops[:3]) + (" …" if len(tops) > 3 else "")
    return f"HTTP {', '.join(methods) or 'requests'} {where}".strip()


ROUTE_ENTRY = re.compile(r"""\{\s*path\s*:\s*['"]([^'"]*)['"][^{}]*?(?:component|element|loadComponent)\s*:\s*(?:<\s*)?([A-Z][\w]*)""", re.S)
JSX_ROUTE = re.compile(r"""<Route\b[^>]*?path=['"{]+([^'"}]*)['"}]+[^>]*?(?:element=\{\s*<\s*([A-Z]\w*)|component=\{\s*([A-Z]\w*))""", re.S)


def ui_routes(content: str) -> list[tuple[str, str]]:
    out = [(m.group(1), m.group(2)) for m in ROUTE_ENTRY.finditer(content)]
    out += [(m.group(1), m.group(2) or m.group(3)) for m in JSX_ROUTE.finditer(content)]
    return [("/" + p.lstrip("/"), c) for p, c in out if c]


def next_route(path: str) -> str | None:
    m = re.match(r"^(?:.*/)?app/(.*?)/?page\.(tsx|jsx|js|ts)$", path)
    if m:
        segs = [("{}" if s.startswith("[") else s) for s in m.group(1).split("/") if s and not (s.startswith("(") and s.endswith(")"))]
        return "/" + "/".join(segs)
    m = re.match(r"^(?:.*/)?pages/(?!api/)(.*)\.(tsx|jsx|js|ts)$", path)
    if m and not m.group(1).startswith("_"):
        segs = [("{}" if s.startswith("[") else s) for s in m.group(1).split("/")]
        if segs[-1] == "index":
            segs = segs[:-1]
        return "/" + "/".join(segs)
    return None


# ------------------------------------------------------------------ main
def build(files: dict[str, str]) -> dict:
    roots = frontend_roots(files)
    comp_of = code.assign_components(sorted(files))
    symbols: list[Symbol] = []
    for p in sorted(files):
        if interfaces.is_test_file(p) or not code.should_index(p, len(files[p]) or 1, 10**9):
            continue
        symbols += extract(p, files[p])

    ifc = code.build_graph(files)["interfaces"]
    by_file: dict[str, list[Symbol]] = defaultdict(list)
    for s in symbols:
        by_file[s.file].append(s)

    def owner(file: str, line: int) -> Symbol | None:
        cands = [s for s in by_file.get(file, []) if s.line <= line <= s.end_line]
        return min(cands, key=lambda s: (s.kind == "module", s.end_line - s.line)) if cands else None

    routes_by_sym: dict[str, list[dict]] = defaultdict(list)
    calls_by_sym: dict[str, list[dict]] = defaultdict(list)
    for r in ifc["routes"]:
        o = owner(r["file"], r["line"])
        if o:
            routes_by_sym[o.id].append(r)
    for c in ifc["calls"]:
        o = owner(c["file"], c["line"])
        if o:
            calls_by_sym[o.id].append(c)

    routed: dict[str, str] = {}
    route_tables: set[str] = set()
    for p, content in files.items():
        entries = ui_routes(content) if p.endswith((".ts", ".tsx", ".js", ".jsx")) else []
        if len(entries) >= 2:
            for s in by_file.get(p, []):
                if s.kind == "module":
                    route_tables.add(s.id)
            for path, comp in entries:
                routed.setdefault(comp, path)

    # ---- roles
    role: dict[str, str] = {}
    tier: dict[str, str] = {}
    for s in symbols:
        fe = is_frontend(s.file, roots, s)
        tier[s.id] = "frontend" if fe else "backend"
        role[s.id] = classify(s, frontend=fe, routed=s.name in routed or bool(next_route(s.file)), has_routes=bool(routes_by_sym.get(s.id)),
                              makes_http_calls=bool(calls_by_sym.get(s.id)), is_route_table=s.id in route_tables)

    # ---- name resolution: prefer same language family, then same tier, then the closest path
    by_name: dict[str, list[Symbol]] = defaultdict(list)
    for s in symbols:
        by_name[s.name].append(s)

    def resolve(name: str, src: Symbol) -> Symbol | None:
        cands = [c for c in by_name.get(name, []) if c is not src]
        if not cands:
            return None
        fam = "jvm" if src.lang in ("java", "kotlin") else src.lang
        same = [c for c in cands if ("jvm" if c.lang in ("java", "kotlin") else c.lang) == fam] or cands
        same = [c for c in same if tier[c.id] == tier[src.id]] or same
        if len(same) == 1:
            return same[0]
        return max(same, key=lambda c: len(posixpath.commonpath([c.file, src.file])) if c.file and src.file else 0)

    sym_by_id = {s.id: s for s in symbols}

    # ---- raw edges
    edges: dict[tuple[str, str, str], dict] = {}
    tags: dict[str, set[str]] = defaultdict(set)

    def add_edge(a: str, b: str, kind: str, **extra) -> dict:
        key = (a, b, kind)
        e = edges.get(key)
        if e is None:
            e = edges[key] = {"from": a, "to": b, "kind": kind, "methods": [], "endpoints": [], "tags": []}
        for k, v in extra.items():
            if k == "evidence":
                e.setdefault("evidence", [])
                e["evidence"] = (e["evidence"] + v)[:20]
            elif isinstance(v, list):
                e[k] = list(dict.fromkeys(e.get(k, []) + v))
            else:
                e[k] = v
        return e

    for s in symbols:
        r = role[s.id]
        seen_targets = set()
        for field_name, tname in s.deps.items():
            t = resolve(tname, s)
            if t is None or t.id == s.id:
                continue
            seen_targets.add(t.id)
            tr = role[t.id]
            if tr in ("dto", "model"):
                tags[s.id].add(t.name)
                continue
            if tr == "entity" and r not in ("repository",):
                continue  # entities are reached through repositories; a direct field just means "uses the record type"
            add_edge(s.id, t.id, "uses", methods=[m for recv, m in s.calls if recv == field_name])
        for name in sorted(s.type_refs | set(s.imports)):
            t = resolve(name, s)
            if t is None or t.id == s.id or t.id in seen_targets:
                continue
            tr = role[t.id]
            if tr in ("dto", "model"):
                tags[s.id].add(t.name)
            elif tr == "entity" and r == "repository":
                add_edge(s.id, t.id, "stores")
            elif tr == "mapper":
                add_edge(s.id, t.id, "uses", methods=[m for recv, m in s.calls if recv == name])
            elif r == "router" and tr in ("page", "component"):
                add_edge(s.id, t.id, "routes", path=routed.get(t.name, ""))
            elif s.kind == "module" and name in s.imports and tr != "entity":
                add_edge(s.id, t.id, "uses", methods=[m for recv, m in s.calls if recv == name])
            elif r in ("page", "component") and tr in ("component", "page", "client"):
                add_edge(s.id, t.id, "uses", methods=[m for recv, m in s.calls if recv == name])
            elif r in ("service", "endpoint", "job") and tr in ("service", "repository") and name in s.imports:
                add_edge(s.id, t.id, "uses", methods=[m for recv, m in s.calls if recv == name])

    # imports of functions/modules: link to the file they come from (Python modules, React/Node function code)
    resolver = code.Resolver(files)
    for s in symbols:
        if s.lang not in ("python", "typescript", "javascript"):
            continue
        for cands in s.import_specs:
            target = resolver.resolve(s.file, "python" if s.lang == "python" else "typescript", cands)
            if not target or target == s.file:
                continue
            tsyms = by_file.get(target, [])
            mod = next((t for t in tsyms if t.kind == "module"), None)
            imported = [t for t in tsyms if t.name in s.imports]
            # imported classes, plus the module itself when plain functions/constants were imported from it
            fn_imports = mod is not None and (not imported or len(imported) < len([n for n in s.imports if n and n[0].islower()]) + len(imported))
            for t in imported + ([mod] if fn_imports and mod not in imported else []):
                tr = role[t.id]
                if tr in ("dto", "model"):
                    tags[s.id].add(t.name)
                elif tr not in ("entity", "config") and (s.id, t.id, "uses") not in edges:
                    add_edge(s.id, t.id, "uses", methods=[m for recv, m in s.calls if recv in (t.name, posixpath.basename(target).rsplit(".", 1)[0])])

    # HTTP: client -> endpoint, matched by method and path
    calls = [{**c, "sym": o} for o_id, cs in calls_by_sym.items() for c in cs for o in [o_id]]
    routes = [{**r, "sym": o} for o_id, rs in routes_by_sym.items() for r in rs for o in [o_id]]
    links, unmatched = interfaces.link_calls(calls, routes)
    for c, rt, score in links:
        if c["sym"] != rt["sym"]:
            add_edge(c["sym"], rt["sym"], "http", endpoints=[f"{rt['method']} {rt['path']}"],
                     evidence=[{"call": f"{c['method']} {c['raw']}", "call_file": c["file"], "call_line": c["line"],
                                "route": f"{rt['method']} {rt['path']}", "route_file": rt["file"], "route_line": rt["line"], "score": score}])

    # ---- promotion: backend code that endpoints/services/jobs depend on is business logic even without a telling name
    #      (Python modules like memory/governance.py); code that talks to a database driver is data access.
    # data access = opens a connection (MongoClient(...), create_engine(...)), or is named/foldered like a DAO
    db_files = {p for p in files if ext.databases_in(files[p]) and
                (ext.connects(files[p]) or re.search(r"(^|/)(db|database|dao|daos|repositor(y|ies)|persistence|store)(\.\w+$|/)", p.lower()))}
    for s in symbols:
        if tier[s.id] == "backend" and role[s.id] in ("util", "other", "service") and s.file in db_files and not routes_by_sym.get(s.id) \
                and not SCRIPT_PATH.search(s.file):
            role[s.id] = "repository"
    for _ in range(4):
        changed = False
        for (a, b, k) in list(edges):
            if k == "uses" and b in role and tier.get(b) == "backend" and role[b] in ("util", "other") and role.get(a) in ("endpoint", "service", "job", "repository"):
                sb = sym_by_id.get(b)
                real_methods = [m for m in (sb.methods if sb else []) if not m.startswith("__")]
                if sb is not None and real_methods and sb.calls and not re.search(r"(Exception|Error)$", sb.name) \
                        and not SCRIPT_PATH.search(sb.file) and not any(a.startswith("dataclass") for a in sb.annotations):
                    role[b] = "repository" if sb.file in db_files else "service"
                    changed = True
        if not changed:
            break

    # ---- externals and databases
    ext_nodes: dict[str, dict] = {}
    db_nodes: dict[str, dict] = {}
    for s in symbols:
        r = role[s.id]
        if r not in ("service", "endpoint", "job", "client", "repository", "entity", "module", "util", "other", "mapper"):
            continue
        content = files[s.file]
        for xid, name, kind in ext.externals_in(content):
            if r in ("util", "other") and not s.calls:
                continue
            node_id = f"ext:{xid}"
            ext_nodes.setdefault(node_id, {"id": node_id, "name": name, "role": "external", "kind": kind})
            if role[s.id] in VISIBLE:
                add_edge(s.id, node_id, "external", label=ext.KIND_VERB.get(kind, "calls"))
        if r in ("repository", "entity"):
            for did, name in ext.databases_in(content):
                node_id = f"db:{did}"
                db_nodes.setdefault(node_id, {"id": node_id, "name": name, "role": "database"})
                if r == "repository":
                    add_edge(s.id, node_id, "data")

    # entities without an explicit database inherit it from the repository that stores them
    for (a, b, k), e in list(edges.items()):
        if k == "stores":
            for (a2, b2, k2) in list(edges):
                if a2 == a and k2 == "data":
                    sym_by_id[b].__dict__.setdefault("_db", b2)

    # ---- which symbols are drawn
    visible = {s.id for s in symbols if role[s.id] in VISIBLE}
    for s in symbols:
        if tier[s.id] == "frontend" and role[s.id] == "service" and not calls_by_sym.get(s.id) \
                and not any(a == s.id and role.get(b) == "client" for (a, b, _) in edges):
            role[s.id] = "util"
            visible.discard(s.id)
    # shared UI widgets are drawn only when they talk to an API client
    for s in symbols:
        if role[s.id] == "component" and any(a == s.id and role.get(b) == "client" for (a, b, _) in edges):
            visible.add(s.id)
    # pages reached only through modules re-exporting them stay; module duplicates of a class in the same file are dropped
    for s in symbols:
        if s.kind == "module" and s.id in visible and not calls_by_sym.get(s.id) and not routes_by_sym.get(s.id) \
                and any(o.kind != "module" and o.id in visible for o in by_file[s.file]):
            visible.discard(s.id)
    # a database box only when nothing more specific (an entity cylinder) represents the storage
    if len(visible) > MAX_NODES:
        ranked = sorted(visible, key=lambda i: (LAYER.get(role[i], 11), i))
        visible = set(ranked[:MAX_NODES])

    # ---- features
    feature_of = assign_features(symbols, role, tier, visible, edges)

    # ---- assemble
    nodes = []
    for s in symbols:
        if s.id not in visible:
            continue
        r = role[s.id]
        node = {"id": s.id, "name": s.name, "label": display_name(s, r), "role": r, "tier": tier[s.id], "lang": s.lang, "file": s.file,
                "line": s.line, "kind": s.kind, "feature": feature_of.get(s.id, "other"), "component": code.slug(comp_of.get(s.file, "")),
                "tags": sorted(tags.get(s.id, set()))[:6], "description": None}
        if routes_by_sym.get(s.id):
            node["routes"] = sorted({f"{x['method']} {x['path']}" for x in routes_by_sym[s.id]})[:40]
        if r == "page":
            node["ui_route"] = routed.get(s.name) or next_route(s.file)
        if r == "job":
            body = "\n".join(files[s.file].splitlines()[s.line - 1:s.end_line])
            sched = re.search(r"@(?:Scheduled|Cron|Interval|scheduled_job|periodic_task)\s*\([^)]*\)|cron\s*[:=]\s*['\"][^'\"]+['\"]|schedule\.every\([^\n]*", body)
            node["schedule"] = sched.group(0)[:80] if sched else None
        if r == "entity":
            node["store"] = next((db_nodes[e[1]]["name"] for e in edges if e[0] in [k[0] for k in edges if k[1] == s.id and k[2] == "stores"]
                                  and e[2] == "data" and e[1] in db_nodes), None)
        nodes.append(node)
    used_ext = {b for (a, b, k) in edges if k == "external" and a in visible}
    nodes += [{**x, "label": x["name"], "tier": "external", "feature": "external", "file": None, "line": None, "tags": [], "description": None}
              for i, x in ext_nodes.items() if i in used_ext]
    # databases are drawn only for repositories whose entity is not shown (e.g. a DAO over raw collections)
    entity_backed = {a for (a, b, k) in edges if k == "stores" and b in visible}
    used_db = {b for (a, b, k) in edges if k == "data" and a in visible and a not in entity_backed}
    nodes += [{**x, "label": x["name"], "tier": "backend", "feature": "data", "file": None, "line": None, "tags": [], "description": None}
              for i, x in db_nodes.items() if i in used_db]
    ids = {n["id"] for n in nodes}

    if any(n["tier"] == "frontend" for n in nodes) or any(n["role"] == "endpoint" for n in nodes):
        entry = [n for n in nodes if n["role"] == "router"] or [n for n in nodes if n["role"] == "page"][:6] or [n for n in nodes if n["role"] == "endpoint"][:6]
        nodes.insert(0, {"id": "actor:user", "name": "User", "label": "User", "role": "actor", "tier": "actor", "feature": "actor", "file": None,
                         "line": None, "tags": [], "description": None})
        for n in entry:
            add_edge("actor:user", n["id"], "actor")
        ids.add("actor:user")

    specificity = {"http": 0, "routes": 1, "stores": 2, "external": 3, "data": 4, "actor": 5, "uses": 6}
    best_kind: dict[tuple[str, str], str] = {}
    for (a, b, k) in edges:
        if (a, b) not in best_kind or specificity[k] < specificity[best_kind[(a, b)]]:
            best_kind[(a, b)] = k
    out_edges = []
    for (a, b, k), e in edges.items():
        if a not in ids or b not in ids or a == b or best_kind[(a, b)] != k:
            continue
        ra, rb = role.get(a, a.split(":")[0]), role.get(b, b.split(":")[0])
        e["label"] = edge_label(e, ra, rb)
        e["tags"] = sorted(tags.get(a, set()) & tags.get(b, set()))[:3]
        e["id"] = hashlib.sha1(f"{a}>{b}>{k}".encode()).hexdigest()[:12]
        out_edges.append(e)

    features = feature_list(nodes)
    hidden = Counter(role[s.id] for s in symbols if s.id not in visible)
    # per-box HTTP facts, so group maps can link a client in one repo to an endpoint in another
    http = {"calls": [{"node": i, **{k: c[k] for k in ("method", "path", "raw", "host", "file", "line")}} for i, cs in calls_by_sym.items() if i in ids for c in cs][:1500],
            "routes": [{"node": i, **{k: r[k] for k in ("method", "path", "raw", "file", "line")}} for i, rs in routes_by_sym.items() if i in ids for r in rs][:1500]}
    return {"version": VERSION, "nodes": nodes, "edges": out_edges, "features": features, "http": http,
            "hidden": dict(hidden), "unmatched_calls": [{k: c[k] for k in ("method", "path", "raw", "host", "file", "line")} for c in unmatched][:60],
            "fingerprint": fingerprint(nodes, out_edges)}


def display_name(s: Symbol, role: str) -> str:
    if s.kind == "module":
        base = s.name.split("/")[-1]
        if base in ("page", "route", "index", "layout") and "/" in s.name:
            base = s.name.split("/")[0]
        return base
    return s.name


def edge_label(e: dict, ra: str, rb: str) -> str:
    k = e["kind"]
    if e.get("label") and k == "external":
        return e["label"]
    if k == "http":
        return http_label([tuple(x.split(" ", 1)) for x in e["endpoints"]])
    if k == "routes":
        return f"routes to {e.get('path') or ''}".strip()
    if k == "stores":
        return "stores"
    if k == "data":
        return "reads & saves"
    if k == "actor":
        return "uses"
    verb = methods_to_verb(e["methods"]) if rb in ("repository",) else None
    if rb == "repository":
        return verb or "reads & saves"
    if ra == "endpoint" and rb == "service":
        return "delegates to"
    if ra == "job":
        return "runs"
    if rb == "mapper":
        return "maps with"
    if rb == "client":
        return "calls"
    if rb in ("page", "component"):
        return "shows"
    if rb == "service":
        return "uses"
    return "uses"


# ------------------------------------------------------------------ feature grouping
def assign_features(symbols: list[Symbol], role: dict[str, str], tier: dict[str, str], visible: set[str], edges: dict) -> dict[str, str]:
    """Backend: one feature per endpoint family (DraftController -> "draft"); services/jobs join the feature that calls
    them (name tokens break ties); repositories and entities form one shared data layer. Frontend: one web-app group
    (split by feature when it is large)."""
    sym = {s.id: s for s in symbols}
    out_adj: dict[str, list[str]] = defaultdict(list)
    in_adj: dict[str, list[str]] = defaultdict(list)
    for (a, b, k) in edges:
        if k in ("uses", "stores", "data"):
            out_adj[a].append(b)
            in_adj[b].append(a)
    feature: dict[str, str] = {}
    keys: dict[str, list[str]] = {}

    def key_for(s: Symbol) -> str:
        toks = domain_tokens(s.name)
        return toks[-1] if toks else (tokens(s.name) or ["core"])[0]

    backend = [i for i in visible if tier.get(i) == "backend" and i in sym]
    for i in backend:
        if role[i] in ("repository", "entity"):
            feature[i] = "data"
    seeds = [i for i in backend if role[i] == "endpoint"]
    for i in seeds:
        k = key_for(sym[i])
        feature[i] = k
        keys.setdefault(k, []).append(i)

    # reach: which features call each service (BFS from each feature's endpoints through "uses")
    reach: dict[str, Counter] = defaultdict(Counter)
    for k, ids in keys.items():
        frontier, dist = list(ids), 0
        seen = set(ids)
        while frontier and dist < 5:
            dist += 1
            nxt = []
            for a in frontier:
                for b in out_adj.get(a, []):
                    if b not in seen and b in sym and role.get(b) in ("service", "mapper", "job"):
                        seen.add(b)
                        reach[b][k] += 10 - dist
                        nxt.append(b)
            frontier = nxt
    for i in backend:
        if i in feature or role[i] not in ("service", "mapper", "job"):
            continue
        toks = set(domain_tokens(sym[i].name))
        named = [k for k in keys if k in toks]
        if reach.get(i):
            best = reach[i].most_common()
            top = [k for k, v in best if v == best[0][1]]
            pick = next((k for k in top if k in toks), None) or next((k for k, _ in best if k in toks), None) or top[0]
            feature[i] = pick
        elif named:
            feature[i] = named[0]
    # jobs and services nobody reaches: follow what they call
    for _ in range(3):
        for i in backend:
            if i in feature:
                continue
            downstream = Counter(feature[b] for b in out_adj.get(i, []) if b in feature and feature[b] != "data")
            upstream = Counter(feature[a] for a in in_adj.get(i, []) if a in feature and feature[a] != "data")
            c = downstream + upstream
            if c:
                feature[i] = c.most_common(1)[0][0]
    for i in backend:
        feature.setdefault(i, "core")

    frontend = [i for i in visible if tier.get(i) == "frontend" and i in sym]
    if len(frontend) > 22:
        for i in frontend:
            toks = domain_tokens(sym[i].name)
            match = next((t for t in reversed(toks) if t in keys), None)
            feature[i] = f"web:{match}" if match else "web"
    else:
        for i in frontend:
            feature[i] = "web"
    return feature


def feature_list(nodes: list[dict]) -> list[dict]:
    groups: dict[str, list[str]] = defaultdict(list)
    for n in nodes:
        groups[n["feature"]].append(n["id"])
    out = []
    for fid, ids in groups.items():
        if fid in ("actor",):
            continue
        tier = "external" if fid == "external" else "frontend" if fid.startswith("web") else "backend"
        if fid == "data":
            name = "Data layer"
        elif fid == "external":
            name = "External systems"
        elif fid == "web":
            name = "Web app"
        elif fid.startswith("web:"):
            name = f"{fid[4:].title()} screens"
        else:
            name = f"{fid.title()}"
        out.append({"id": fid, "name": name, "tier": tier, "description": None, "node_ids": ids})
    order = {"frontend": 0, "backend": 1, "external": 3}
    return sorted(out, key=lambda f: (order[f["tier"]], f["id"] == "data", f["id"] == "core", f["name"]))


def fingerprint(nodes: list[dict], edges: list[dict]) -> str:
    data = json.dumps([[n["id"], n["role"], n["feature"]] for n in nodes] + [[e["from"], e["to"], e["kind"]] for e in edges], sort_keys=True)
    return hashlib.sha1(data.encode()).hexdigest()[:16]
