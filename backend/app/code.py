"""Repository analysis: file classification, import extraction and the component dependency graph.
Everything here is static analysis of the files actually indexed; nothing is hand-placed or invented."""
from __future__ import annotations

import json
import posixpath
import re
from collections import Counter, defaultdict

LANG_BY_EXT = {
    "ts": "typescript", "tsx": "typescript", "js": "javascript", "jsx": "javascript", "mjs": "javascript", "cjs": "javascript",
    "py": "python", "go": "go", "java": "java", "kt": "kotlin", "rs": "rust", "rb": "ruby", "php": "php", "cs": "csharp",
    "c": "c", "h": "c", "cpp": "cpp", "hpp": "cpp", "swift": "swift", "sql": "sql", "sh": "shell",
    "json": "json", "yml": "yaml", "yaml": "yaml", "toml": "toml", "md": "markdown", "css": "css", "html": "html",
    "gradle": "gradle", "txt": "text", "proto": "protobuf", "tf": "terraform",
}
CODE_LANGS = {"typescript", "javascript", "python", "go", "java", "kotlin", "rust", "ruby", "php", "csharp", "c", "cpp", "swift", "sql", "shell"}
SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "build", "out", "__pycache__", ".venv", "venv", "target", "vendor", "coverage",
             ".idea", ".vscode", ".gradle", "Pods", ".terraform", ".cache"}
SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "uv.lock", "poetry.lock", "Cargo.lock", "go.sum", "composer.lock", "Gemfile.lock"}
NAMED_TEXT = {"Dockerfile", "Makefile", "CODEOWNERS", "LICENSE", "README"}
CONTAINERS = {"services", "packages", "apps", "libs", "modules", "plugins", "crates", "cmd", "internal", "pkg"}
JS_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]


def language_of(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    if name in NAMED_TEXT:
        return "text"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return LANG_BY_EXT.get(ext, "")


def should_index(path: str, size: int, max_bytes: int) -> bool:
    parts = path.split("/")
    if any(p in SKIP_DIRS for p in parts[:-1]) or parts[-1] in SKIP_FILES or size > max_bytes or size == 0:
        return False
    return bool(language_of(path))


# ------------------------------------------------------------------ import extraction
_JS_IMPORT = re.compile(r"""(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?['"]([^'"\n]+)['"]|require\(\s*['"]([^'"\n]+)['"]\s*\)|import\(\s*['"]([^'"\n]+)['"]\s*\)""")
_PY_FROM = re.compile(r"^\s*from\s+([.\w]+)\s+import\s+(.+?)\s*(?:#.*)?$", re.M)
_PY_IMPORT = re.compile(r"^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)", re.M)
_GO_IMPORT = re.compile(r'^\s*(?:import\s+)?(?:[\w.]+\s+)?"([\w./-]+)"\s*$', re.M)
_JAVA_IMPORT = re.compile(r"^\s*import\s+(?:static\s+)?([\w.]+)\s*;", re.M)
_C_INCLUDE = re.compile(r'^\s*#include\s+"([^"]+)"', re.M)


def extract_imports(content: str, lang: str) -> list[list[str]]:
    """Each entry is an ordered list of candidate specifiers; the first that resolves to a repo file wins."""
    out: list[list[str]] = []
    if lang in ("typescript", "javascript"):
        for m in _JS_IMPORT.finditer(content):
            out.append([next(g for g in m.groups() if g)])
    elif lang == "python":
        for m in _PY_FROM.finditer(content):
            mod = m.group(1)
            names = [n.strip().split(" as ")[0].strip("() ") for n in m.group(2).split(",")]
            for n in names:
                if n and n != "*":
                    out.append([f"{mod}{'' if mod.endswith('.') else '.'}{n}", mod])
            if not names:
                out.append([mod])
        for m in _PY_IMPORT.finditer(content):
            for mod in m.group(1).split(","):
                out.append([mod.strip()])
    elif lang == "go":
        out = [[m.group(1)] for m in _GO_IMPORT.finditer(content) if "/" in m.group(1)]
    elif lang in ("java", "kotlin"):
        out = [[m.group(1)] for m in _JAVA_IMPORT.finditer(content)]
    elif lang in ("c", "cpp"):
        out = [[m.group(1)] for m in _C_INCLUDE.finditer(content)]
    return out


# ------------------------------------------------------------------ resolution
class Resolver:
    def __init__(self, files: dict[str, str]):
        self.paths = set(files)
        self.py_index: dict[str, list[str]] = defaultdict(list)
        self.java_index: dict[str, list[str]] = {}
        self.by_dir: dict[str, list[str]] = defaultdict(list)
        self.pkg_dirs: dict[str, str] = {}  # workspace package name -> directory
        for p in self.paths:
            self.by_dir[posixpath.dirname(p)].append(p)
            if p.endswith(".py"):
                dotted = p[:-3].replace("/", ".")
                if dotted.endswith(".__init__"):
                    dotted = dotted[: -len(".__init__")]
                parts = dotted.split(".")
                for i in range(len(parts)):
                    self.py_index[".".join(parts[i:])].append(p)
            elif p.endswith((".java", ".kt")):
                self.java_index[p.rsplit(".", 1)[0]] = p
            if p.endswith("package.json"):
                try:
                    name = json.loads(files[p]).get("name")
                    if name:
                        self.pkg_dirs[name] = posixpath.dirname(p)
                except (ValueError, AttributeError):
                    pass

    def _js_file(self, base: str) -> str | None:
        base = posixpath.normpath(base)
        for cand in [base] + [base + e for e in JS_EXT] + [f"{base}/index{e}" for e in JS_EXT]:
            if cand in self.paths:
                return cand
        return None

    def resolve(self, importer: str, lang: str, cands: list[str]) -> str | None:
        for spec in cands:
            r = self._one(importer, lang, spec)
            if r and r != importer:
                return r
        return None

    def _one(self, importer: str, lang: str, spec: str) -> str | None:
        d = posixpath.dirname(importer)
        if lang in ("typescript", "javascript"):
            if spec.startswith("."):
                return self._js_file(posixpath.join(d, spec))
            if spec.startswith(("@/", "~/")):
                parts = d.split("/") if d else []
                for i in range(len(parts), -1, -1):  # tsconfig "@/*" usually maps to the package root: try every ancestor
                    hit = self._js_file(posixpath.join("/".join(parts[:i]), spec[2:]))
                    if hit:
                        return hit
                return None
            for name, pdir in self.pkg_dirs.items():
                if spec == name or spec.startswith(name + "/"):
                    sub = spec[len(name) + 1:]
                    for base in ([posixpath.join(pdir, sub), posixpath.join(pdir, "src", sub)] if sub else [pdir + "/src/index", pdir + "/index"]):
                        hit = self._js_file(base)
                        if hit:
                            return hit
                    under = self.by_dir.get(pdir) or self.by_dir.get(pdir + "/src")
                    return under[0] if under else None
            return None
        if lang == "python":
            if spec.startswith("."):
                dots = len(spec) - len(spec.lstrip("."))
                base = d
                for _ in range(dots - 1):
                    base = posixpath.dirname(base)
                rest = spec.lstrip(".").replace(".", "/")
                for cand in ([posixpath.join(base, rest) + ".py", posixpath.join(base, rest, "__init__.py")] if rest else [posixpath.join(base, "__init__.py")]):
                    if cand in self.paths:
                        return cand
                return None
            hits = self.py_index.get(spec)
            if not hits:
                return None
            if len(hits) > 1:  # ambiguous: prefer the one sharing the importer's top-level directory
                top = importer.split("/")[0]
                same = [h for h in hits if h.split("/")[0] == top]
                hits = same or hits
            return hits[0]
        if lang in ("java", "kotlin"):
            tail = spec.replace(".", "/")
            for k, v in self.java_index.items():
                if k.endswith(tail):
                    return v
            return None
        if lang == "go":
            segs = spec.split("/")
            for n in (3, 2, 1):
                tail = "/".join(segs[-n:])
                for dirp, fs in self.by_dir.items():
                    if (dirp == tail or dirp.endswith("/" + tail)) and any(f.endswith(".go") for f in fs):
                        return next(f for f in fs if f.endswith(".go"))
            return None
        if lang in ("c", "cpp"):
            hit = posixpath.normpath(posixpath.join(d, spec))
            if hit in self.paths:
                return hit
            same = [p for p in self.paths if p.endswith("/" + spec) or p == spec]
            return same[0] if len(same) == 1 else None
        return None


# ------------------------------------------------------------------ components
def assign_components(paths: list[str]) -> dict[str, str]:
    """Group files into architectural components (directories). Splits oversized directories and
    monorepo containers (services/, packages/, ...) one level deeper, up to three levels."""
    total = len(paths)
    comp = {p: (p.split("/")[0] if "/" in p else "(root)") for p in paths}
    limit = max(12, int(total * 0.35))  # small repos still get a readable graph; large ones split only their dominant directories
    for _ in range(3):
        counts = Counter(comp.values())
        changed = False
        for c, n in counts.items():
            depth = c.count("/") + 1
            if c == "(root)" or depth >= 3:
                continue
            is_container = c.split("/")[-1] in CONTAINERS
            if not (is_container or n > limit):
                continue
            members = [p for p in paths if comp[p] == c]
            subs = {p.split("/")[depth] for p in members if p.count("/") > depth}
            if len(subs) < 2 and not is_container:
                continue
            for p in members:
                if p.count("/") > depth:
                    comp[p] = f"{c}/{p.split('/')[depth]}"
                    changed = True
        if not changed:
            break
    return comp


def _kind(comp: str, files: list[str], langs: Counter) -> str:
    segs = comp.lower().split("/")
    name = segs[-1]
    if name in {"db", "database", "migrations", "schema", "prisma", "sql"} or (files and all(f.endswith(".sql") for f in files)):
        return "datastore"
    if segs[0] in {"packages", "libs", "lib", "pkg", "crates", "shared", "common"}:
        return "package"
    if segs[0] in {"services", "apps", "cmd", "backend", "server", "api", "frontend", "web", "client"}:
        return "service"
    code = sum(v for k, v in langs.items() if k in CODE_LANGS)
    if segs[0] in {".github", "config", "configs", "infra", "deploy", "docs", "scripts", "terraform"} or code == 0:
        return "config"
    return "module"


def slug(comp: str) -> str:
    return "~root" if comp == "(root)" else comp.replace("/", "~")


def build_graph(files: dict[str, str]) -> dict:
    """files: path -> content. Returns {"nodes": [...], "edges": [...]} (no memory counts; added per request)."""
    paths = sorted(files)
    comp_of = assign_components(paths)
    resolver = Resolver(files)
    edge_w: Counter = Counter()
    for p in paths:
        lang = language_of(p)
        for cands in extract_imports(files[p], lang):
            target = resolver.resolve(p, lang, cands)
            if target and comp_of.get(target) and comp_of[target] != comp_of[p]:
                edge_w[(comp_of[p], comp_of[target])] += 1

    by_comp: dict[str, list[str]] = defaultdict(list)
    for p in paths:
        by_comp[comp_of[p]].append(p)
    labels = Counter(c.split("/")[-1] for c in by_comp)
    nodes = []
    for c, fs in sorted(by_comp.items()):
        langs = Counter(language_of(f) for f in fs if language_of(f))
        nodes.append({
            "id": slug(c), "label": c.split("/")[-1] if labels[c.split("/")[-1]] == 1 else c, "kind": _kind(c, fs, langs),
            "path": "" if c == "(root)" else c, "file_count": len(fs), "loc": sum(files[f].count("\n") + 1 for f in fs),
            "languages": [k for k, _ in langs.most_common(3)], "files": fs[:500],
        })
    edges = [{"from": slug(a), "to": slug(b), "weight": w, "kind": "imports"} for (a, b), w in sorted(edge_w.items())]
    return {"nodes": nodes, "edges": edges}
