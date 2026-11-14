"""Cross-component and cross-repository interfaces, found by static analysis of indexed files.

- routes:   HTTP endpoints a repository SERVES (FastAPI, Flask, Express/Fastify, Next.js route handlers, Go net/http / chi /
            gin, Spring). Router prefixes declared in the same file are applied.
- calls:    HTTP endpoints a repository CALLS (fetch, axios, ky, API-client helpers such as `get("/notes")`, requests/httpx).
            Template and f-string parameters become `{}`; a leading `${BASE}` or full URL host is dropped.
- provides: package names a repository publishes (package.json, pyproject.toml, go.mod).
- requires: external package names a repository imports (bare imports that do not resolve to one of its own files).

Every item keeps its file and line, so every edge built from them can show its evidence. Nothing is inferred beyond what
is written in the code: URLs assembled at runtime, GraphQL, gRPC and message queues are not detected."""
from __future__ import annotations

import json
import posixpath
import re
from collections import defaultdict

HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
ANY = "*"
MAX_ITEMS = 2000
API_LANGS = {"typescript", "javascript", "python", "go", "java", "kotlin"}
_PARAM_SEG = re.compile(r"^(?:\{[^}]*\}|:\w+|<[^>]*>|\[[^\]]*\]|\*|\*\w+)$")


def _line(content: str, pos: int) -> int:
    return content.count("\n", 0, pos) + 1


def is_test_file(path: str) -> bool:
    parts = path.lower().split("/")
    name = parts[-1]
    return (any(p in {"test", "tests", "__tests__", "spec", "specs", "e2e", "cypress", "__mocks__", "fixtures"} for p in parts[:-1])
            or ".test." in name or ".spec." in name or name.startswith("test_") or name.endswith("_test.py") or name.endswith("_test.go"))


def norm_path(raw: str) -> str | None:
    """'/notes/${id}?x=1' -> '/notes/{}'. Returns None when the string is not an absolute URL path."""
    s = (raw or "").strip()
    s = re.sub(r"^https?://[^/]+", "", s)
    s = re.sub(r"^(?:\$\{[^}]*\}|\{[^}]*\})+", "", s)  # `${API_BASE}/x`, f"{BASE}/x"
    s = re.split(r"[?#]", s, maxsplit=1)[0]
    if not s.startswith("/") or " " in s or len(s) > 300:
        return None
    segs = []
    for seg in s.split("/"):
        if not seg:
            continue
        segs.append("{}" if _PARAM_SEG.match(seg) or "${" in seg or ("{" in seg and "}" in seg) else seg)
    return "/" + "/".join(segs)


def _host(raw: str) -> str | None:
    m = re.match(r"^https?://([^/]+)", raw.strip())
    return m.group(1) if m else None


def _segs(path: str) -> list[str]:
    return [s for s in path.split("/") if s]


def _join(prefix: str, path: str) -> str:
    return "/" + "/".join(_segs(prefix) + _segs(path))


# ------------------------------------------------------------------ routes
_PY_ROUTER = re.compile(r"""(\w+)\s*=\s*(?:APIRouter|Blueprint|FastAPI|Flask)\(([^)]*)\)""")
_PY_PREFIX = re.compile(r"""(?:prefix|url_prefix|root_path)\s*=\s*['"]([^'"]+)['"]""")
_PY_ROUTE = re.compile(r"""@\s*(\w+)\.(get|post|put|patch|delete|head|options|route|api_route)\(\s*(?:path\s*=\s*)?['"]([^'"]*)['"]([^)]*)\)""", re.I)
_PY_METHODS = re.compile(r"""methods\s*=\s*[\[(]([^\])]*)[\])]""")
_JS_ROUTE = re.compile(r"""(?<![\w.$])(app|router|server|fastify|routes?|\w*[Rr]outer)\.(get|post|put|patch|delete|all|head|options)\(\s*['"`](/[^'"`]*)['"`]\s*,""")
_NEXT_EXPORT = re.compile(r"""export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b""")
_GO_ROUTE = re.compile(r"""\.(HandleFunc|Handle|Get|Post|Put|Patch|Delete|GET|POST|PUT|PATCH|DELETE|Any)\(\s*"(?:([A-Z]+)\s+)?(/[^"]*)\"""")
_JAVA_MAPPING = re.compile(r"""@(Get|Post|Put|Patch|Delete|Request)Mapping\s*(?:\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*"([^"]*)"[^)]*\))?""")
_JAVA_REQ_METHOD = re.compile(r"""RequestMethod\.(\w+)""")


def _route(method: str, raw: str, file: str, line: int, framework: str) -> dict | None:
    path = norm_path(raw if raw.startswith("/") else "/" + raw)
    if path is None:
        return None
    m = method.upper()
    return {"method": m if m in HTTP_METHODS else ANY, "path": path, "raw": raw, "file": file, "line": line, "framework": framework}


def _next_route_path(path: str) -> str | None:
    """Next.js: app/api/notes/[id]/route.ts -> /api/notes/{} ; pages/api/notes/index.ts -> /api/notes"""
    m = re.match(r"^(?:.*/)?app/(.*?)/?route\.(?:ts|js|tsx|jsx|mjs)$", path)
    if m:
        segs = [s for s in m.group(1).split("/") if s and not (s.startswith("(") and s.endswith(")")) and not s.startswith("@")]
        return "/" + "/".join(segs)
    m = re.match(r"^(?:.*/)?pages/(api/.*)\.(?:ts|js|tsx|jsx|mjs)$", path)
    if m:
        segs = m.group(1).split("/")
        if segs[-1] == "index":
            segs = segs[:-1]
        return "/" + "/".join(segs)
    return None


def extract_routes(path: str, content: str, lang: str) -> list[dict]:
    out: list[dict] = []
    if lang == "python":
        prefixes = {}
        for m in _PY_ROUTER.finditer(content):
            pm = _PY_PREFIX.search(m.group(2))
            prefixes[m.group(1)] = pm.group(1) if pm else ""
        for m in _PY_ROUTE.finditer(content):
            recv, verb, raw, rest = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
            if verb in ("route", "api_route"):
                mm = _PY_METHODS.search(rest)
                methods = re.findall(r"""['"](\w+)['"]""", mm.group(1)) if mm else (["GET"] if verb == "route" else [ANY])
            else:
                methods = [verb]
            full = _join(prefixes.get(recv, ""), raw) if raw or prefixes.get(recv) else "/"
            for meth in methods:
                r = _route(meth, full, path, _line(content, m.start()), "fastapi/flask")
                if r:
                    out.append(r)
    elif lang in ("typescript", "javascript"):
        next_path = _next_route_path(path)
        if next_path is not None:
            methods = _NEXT_EXPORT.findall(content)
            if "/pages/" in "/" + path or path.startswith("pages/"):
                methods = methods or [ANY]
            for meth in methods or []:
                pos = content.find(meth) if meth != ANY else 0
                r = _route(meth, next_path, path, _line(content, max(pos, 0)), "nextjs")
                if r:
                    out.append(r)
        for m in _JS_ROUTE.finditer(content):
            verb = m.group(2).upper()
            r = _route(ANY if verb == "ALL" else verb, m.group(3), path, _line(content, m.start()), "express")
            if r:
                out.append(r)
    elif lang == "go":
        for m in _GO_ROUTE.finditer(content):
            verb = (m.group(2) or ("" if m.group(1) in ("HandleFunc", "Handle", "Any") else m.group(1))).upper()
            r = _route(verb or ANY, m.group(3), path, _line(content, m.start()), "go")
            if r:
                out.append(r)
    elif lang in ("java", "kotlin"):
        cls = re.search(r"\b(?:class|interface)\s+\w+", content)
        cls_pos = cls.start() if cls else -1
        prefix = ""
        for m in _JAVA_MAPPING.finditer(content):
            kind, raw = m.group(1), m.group(2) or ""
            if cls_pos >= 0 and m.start() < cls_pos:
                if kind == "Request":
                    prefix = raw
                continue
            if kind == "Request":
                rm = _JAVA_REQ_METHOD.search(m.group(0))
                verb = rm.group(1) if rm else ANY
            else:
                verb = kind
            r = _route(verb, _join(prefix, raw), path, _line(content, m.start()), "spring")
            if r:
                out.append(r)
    return out


# ------------------------------------------------------------------ calls
_Q = r"""(['"`])((?:(?!\1)[^\n]){1,300})\1"""
_FETCH_CALL = re.compile(r"""(?<![\w.$])(fetch|axios|ky|ofetch|\$fetch|useFetch|useSWR|apiFetch|request)\s*(?:<[^()\n]*?>)?\(\s*""" + _Q.replace("\\1", "\\2"))
_METHOD_CALL = re.compile(r"""(?<![@\w.$])([\w$]+(?:\.[\w$]+)*)\.(get|post|put|patch|delete|del)\s*(?:<[^()\n]*?>)?\(\s*f?""" + _Q.replace("\\1", "\\3"))
_HELPER_CALL = re.compile(r"""(?<![\w.$@])(get|post|put|patch|del|delete|getJson|postJson|apiGet|apiPost)\s*(?:<[^()\n]*?>)?\(\s*""" + _Q.replace("\\1", "\\2"))
_METHOD_OPT = re.compile(r"""method\s*:\s*['"](\w+)['"]""", re.I)
_VERB = {"get": "GET", "post": "POST", "put": "PUT", "patch": "PATCH", "delete": "DELETE", "del": "DELETE", "getjson": "GET", "postjson": "POST",
         "apiget": "GET", "apipost": "POST"}


def _rest_of_call(content: str, pos: int, limit: int = 600) -> str:
    """Text from `pos` to the parenthesis closing the call that `pos` is inside, so options are read from this call only."""
    depth = 1
    for i in range(pos, min(len(content), pos + limit)):
        ch = content[i]
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth == 0:
                return content[pos:i]
    return content[pos:pos + limit]


# URL-valued variables: `private apiUrl = \`${environment.apiUrl}/blog\``, `BASE_URL = "http://..."`, `apiUrl: 'http://...'`
_ASSIGN = re.compile(r"""(?:\b(?:this|self)\.)?(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n;,()]{1,40})?=\s*f?(['"`])((?:(?!\2)[^\n]){1,300})\2""")
_PROP = re.compile(r"""(?<![\w$.])([A-Za-z_$][\w$]*)\s*:\s*(['"`])((?:(?!\2)[^\n]){1,300})\2""")
_CONFIG_FILE = re.compile(r"""(^|/)(environments?|config|configs|constants?|settings|env)(/|[^/]*$)""", re.I)
_TPL_EXPR = re.compile(r"""\$\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}|(?<![$\w])\{\s*([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*\}""")
_IDENT_ARG = r"""((?:this\.|self\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*[,)]"""
_METHOD_CALL_IDENT = re.compile(r"""(?<![@\w.$])([\w$]+(?:\.[\w$]+)*)\.(get|post|put|patch|delete)\s*(?:<[^()\n]*?>)?\(\s*""" + _IDENT_ARG)
_FETCH_IDENT = re.compile(r"""(?<![\w.$])(fetch|axios|ky|ofetch|\$fetch|useSWR)\s*(?:<[^()\n]*?>)?\(\s*""" + _IDENT_ARG)


def _urlish(v: str) -> bool:
    return v.startswith(("http://", "https://", "/", "${", "{")) and " " not in v


def url_vars(content: str) -> dict[str, str]:
    """Variables/properties in one file whose value looks like a URL or URL path (first definition wins)."""
    out: dict[str, str] = {}
    for rx in (_ASSIGN, _PROP):
        for m in rx.finditer(content):
            name, val = m.group(1), m.group(3).strip()
            if _urlish(val) and name not in out:
                out[name] = val
    return out


def config_urls(files: dict[str, str]) -> dict[str, str]:
    """Repo-wide URL constants from environment/config files. A name is kept only when every definition agrees on the
    path (environment.ts and environment.prod.ts usually differ only in host), so ambiguous names stay unresolved."""
    cands: dict[str, list[str]] = defaultdict(list)
    for p in sorted(files):
        if _CONFIG_FILE.search(p) and not is_test_file(p):
            for name, val in url_vars(files[p]).items():
                cands[name].append(val)
    out = {}
    for name, vals in cands.items():
        paths = {norm_path(v) for v in vals}
        if len(paths) == 1:
            out[name] = sorted(vals, key=lambda v: ("localhost" not in v, v))[0]
    return out


def resolve_url(raw: str, local: dict[str, str], glob: dict[str, str], depth: int = 0) -> str:
    """Substitute `${this.apiUrl}` / `${environment.apiUrl}` / `{settings.BASE}` with known URL values (3 levels deep)."""
    if depth > 3:
        return raw

    def sub(m: re.Match) -> str:
        expr = m.group(1) or m.group(2)
        val = lookup(expr, local, glob)
        return resolve_url(val, local, glob, depth + 1) if val is not None else m.group(0)

    return _TPL_EXPR.sub(sub, raw)


def lookup(expr: str, local: dict[str, str], glob: dict[str, str]) -> str | None:
    parts = expr.split(".")
    name, qual = parts[-1], (parts[0] if len(parts) > 1 else None)
    if qual in (None, "this", "self"):
        return local.get(name) if name in local else glob.get(name)
    return glob.get(name)  # environment.apiUrl, settings.API_URL: defined in a config file


def extract_calls(path: str, content: str, lang: str, skip_positions: set[int] | None = None, consts: dict[str, str] | None = None) -> list[dict]:
    if lang not in ("typescript", "javascript", "python") or is_test_file(path):
        return []
    skip = skip_positions or set()
    out: list[dict] = []
    seen: set[int] = set()
    local = url_vars(content)
    glob = consts or {}

    def add(pos: int, method: str, raw: str) -> None:
        if pos in skip or pos in seen:
            return
        raw = resolve_url(raw, local, glob)
        p = norm_path(raw)
        if p is None or not any(s != "{}" for s in _segs(p)):
            return
        seen.add(pos)
        out.append({"method": method, "path": p, "raw": raw[:200], "host": _host(raw), "file": path, "line": _line(content, pos)})

    for m in _FETCH_CALL.finditer(content):
        meth = _METHOD_OPT.search(_rest_of_call(content, m.end()))
        add(m.start(), meth.group(1).upper() if meth else ("GET" if m.group(1) in ("fetch", "useSWR", "useFetch", "ky", "ofetch", "$fetch", "apiFetch") else ANY),
            m.group(3))
    for m in _METHOD_CALL.finditer(content):
        recv = m.group(1)
        if lang == "python" and recv.split(".")[-1] in ("os", "environ", "headers", "params", "json", "kwargs", "data", "request", "cookies", "settings"):
            continue
        if lang != "python" and recv.split(".")[-1] in ("headers", "params", "searchParams", "cookies", "map", "cache", "localStorage", "sessionStorage"):
            continue
        add(m.start(), _VERB[m.group(2).lower()], m.group(4))
    for m in _HELPER_CALL.finditer(content):
        add(m.start(), _VERB[m.group(1).lower()], m.group(3))
    # a variable as the URL: this.http.get(this.apiUrl), fetch(API_URL), requests.post(self.url)
    for m in _METHOD_CALL_IDENT.finditer(content):
        val = lookup(m.group(3), local, glob)
        if val is not None:
            add(m.start(), _VERB[m.group(2).lower()], val)
    for m in _FETCH_IDENT.finditer(content):
        val = lookup(m.group(2), local, glob)
        if val is not None:
            meth = _METHOD_OPT.search(_rest_of_call(content, m.end()))
            add(m.start(), meth.group(1).upper() if meth else ("GET" if m.group(1) != "axios" else ANY), val)
    return out


def route_positions(content: str, lang: str) -> set[int]:
    """Offsets where a route DEFINITION starts, so `router.get("/x", handler)` is never also read as an outgoing call."""
    if lang in ("typescript", "javascript"):
        return {m.start() for m in _JS_ROUTE.finditer(content)}
    return set()


# ------------------------------------------------------------------ packages
def norm_pkg(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def extract_provides(path: str, content: str) -> list[dict]:
    name = path.rsplit("/", 1)[-1]
    out = []
    if name == "package.json":
        try:
            n = json.loads(content).get("name")
            if isinstance(n, str) and n:
                out.append({"name": n, "ecosystem": "npm"})
        except (ValueError, AttributeError):
            pass
    elif name == "pyproject.toml":
        m = re.search(r"""^\[(?:project|tool\.poetry)\][^\[]*?^name\s*=\s*['"]([^'"]+)['"]""", content, re.M | re.S)
        if m:
            out.append({"name": m.group(1), "ecosystem": "python"})
    elif name == "go.mod":
        m = re.search(r"^module\s+(\S+)", content, re.M)
        if m:
            out.append({"name": m.group(1), "ecosystem": "go"})
    return [{**o, "file": path, "line": 1} for o in out]


def external_package(spec: str, lang: str) -> str | None:
    """The package name an unresolved import refers to, or None for relative/alias imports."""
    if lang in ("typescript", "javascript"):
        if spec.startswith((".", "/", "@/", "~/", "node:")) or "://" in spec:
            return None
        parts = spec.split("/")
        return "/".join(parts[:2]) if spec.startswith("@") and len(parts) > 1 else parts[0]
    if lang == "python":
        return None if spec.startswith(".") else spec.split(".")[0]
    if lang == "go":
        return spec if "." in spec.split("/")[0] else None
    return None


def provides_match(required: str, eco: str, provided: dict) -> bool:
    if eco != provided["ecosystem"]:
        return False
    if eco == "go":
        return required == provided["name"] or required.startswith(provided["name"] + "/")
    return norm_pkg(required) == norm_pkg(provided["name"])


# ------------------------------------------------------------------ analysis entry point
def analyze(files: dict[str, str], language_of, comp_of: dict[str, str], unresolved: dict[str, list[tuple[str, str]]]) -> dict:
    """files: path -> content; comp_of: path -> component name; unresolved: path -> [(import spec, lang)]."""
    routes, calls, provides = [], [], []
    consts = config_urls(files)
    for p in sorted(files):
        lang = language_of(p)
        content = files[p]
        provides += extract_provides(p, content)
        if lang not in API_LANGS:
            continue
        if not is_test_file(p):
            routes += extract_routes(p, content, lang)
        calls += extract_calls(p, content, lang, route_positions(content, lang), consts)
    eco = {"typescript": "npm", "javascript": "npm", "python": "python", "go": "go"}
    req: dict[tuple[str, str, str], dict] = {}
    for p, specs in unresolved.items():
        if is_test_file(p):
            continue
        for spec, lang in specs:
            name = external_package(spec, lang)
            if name and lang in eco:
                key = (name, eco[lang], comp_of.get(p, ""))
                if key not in req:
                    req[key] = {"name": name, "ecosystem": eco[lang], "component": comp_of.get(p, ""), "file": p, "count": 0}
                req[key]["count"] += 1
    for item in routes + calls + provides:
        item["component"] = comp_of.get(item["file"], "")
    return {"routes": routes[:MAX_ITEMS], "calls": calls[:MAX_ITEMS], "provides": provides[:200], "requires": list(req.values())[:MAX_ITEMS]}


# ------------------------------------------------------------------ linking
def _seg_eq(a: str, b: str) -> bool:
    return a == "{}" or b == "{}" or a.lower() == b.lower()


def path_score(call: str, route: str) -> float:
    """1.0 exact (parameters match anything); 0.8 when the call carries up to two extra leading segments the route does not
    declare (a prefix mounted elsewhere, e.g. /api); 0.7 when the route carries them (a base URL held in config)."""
    c, r = _segs(call), _segs(route)
    if not c or not r:
        return 0.0
    if len(c) == len(r):
        return 1.0 if all(map(_seg_eq, c, r)) and any(s != "{}" for s in c) and any(s != "{}" for s in r) else 0.0
    longer, shorter, score = (c, r, 0.8) if len(c) > len(r) else (r, c, 0.7)
    d = len(longer) - len(shorter)
    if d > 2 or not any(s != "{}" for s in shorter):
        return 0.0
    tail = longer[d:]
    if not all(map(_seg_eq, tail, shorter)):
        return 0.0
    # the overlapping part must agree on at least one literal segment, not only on parameters
    if not any(a != "{}" and b != "{}" for a, b in zip(tail, shorter)):
        return 0.0
    return score


def method_ok(a: str, b: str) -> bool:
    return a == ANY or b == ANY or a == b


def link_calls(calls: list[dict], routes: list[dict]) -> tuple[list[tuple[dict, dict, float]], list[dict]]:
    """Each call is linked to its best-scoring route(s) (ties kept, at most 3). Returns (links, unmatched calls)."""
    by_last: dict[str, list[dict]] = defaultdict(list)
    for r in routes:
        segs = _segs(r["path"])
        by_last[segs[-1].lower() if segs and segs[-1] != "{}" else "{}"].append(r)
    links, unmatched = [], []
    for c in calls:
        segs = _segs(c["path"])
        last = segs[-1].lower() if segs and segs[-1] != "{}" else "{}"
        cands = by_last.get(last, []) + (by_last.get("{}", []) if last != "{}" else [r for rs in by_last.values() for r in rs])
        best, picked = 0.0, []
        for r in cands:
            if not method_ok(c["method"], r["method"]):
                continue
            s = path_score(c["path"], r["path"])
            if s > best:
                best, picked = s, [r]
            elif s and s == best and len(picked) < 3:
                picked.append(r)
        if picked:
            links += [(c, r, best) for r in picked]
        else:
            unmatched.append(c)
    return links, unmatched


def link_packages(requires: list[dict], provides: list[dict]) -> list[tuple[dict, dict]]:
    return [(rq, pv) for rq in requires for pv in provides if provides_match(rq["name"], rq["ecosystem"], pv)]
