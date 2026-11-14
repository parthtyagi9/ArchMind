"""Tree-sitter extraction: every source file becomes a list of symbols (classes, interfaces, records, enums, and one
module symbol per file whose top-level code matters: route handlers, React components, Express routers, scripts).

For each symbol we record only facts that are written in the code:
- annotations / decorators (@RestController, @Injectable, @router.get ...)
- base types (extends / implements / Python bases / Kotlin supertypes)
- injected dependencies: constructor parameters, fields and properties with a type (Spring, Angular, NestJS, Kotlin,
  Python __init__ annotations, Angular `inject(X)`, FastAPI `Depends(x)`)
- member calls `field.method(...)` (so an edge can say "saves" or "findByStatus")
- capitalised type names referenced anywhere in the body (DTOs, entities, `new X()`)
- imported names (module-level code links to what it imports)

Languages: Java, Kotlin, TypeScript/TSX, JavaScript/JSX, Python, Go. Unknown languages produce no symbols."""
from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass, field
from functools import lru_cache

from tree_sitter import Language, Node, Parser

MAX_SYMBOLS_PER_FILE = 60


@dataclass
class Symbol:
    name: str
    kind: str  # class | interface | enum | record | module
    lang: str
    file: str
    line: int
    end_line: int
    annotations: list[str] = field(default_factory=list)
    annotation_text: list[str] = field(default_factory=list)  # full text, e.g. '@Scheduled(cron = "...")'
    bases: list[str] = field(default_factory=list)
    deps: dict[str, str] = field(default_factory=dict)  # field/param name -> type name
    calls: list[tuple[str, str]] = field(default_factory=list)  # (receiver field, method)
    type_refs: set[str] = field(default_factory=set)
    imports: list[str] = field(default_factory=list)  # imported identifiers (module symbols)
    import_specs: list[list[str]] = field(default_factory=list)  # module specifiers, candidates first-to-last
    method_annotations: list[str] = field(default_factory=list)
    methods: list[str] = field(default_factory=list)
    jsx: bool = False

    @property
    def id(self) -> str:
        return f"{self.file}#{self.name}"


@lru_cache(maxsize=None)
def _parser(lang: str) -> Parser | None:
    try:
        if lang == "java":
            import tree_sitter_java as m
            return Parser(Language(m.language()))
        if lang == "kotlin":
            import tree_sitter_kotlin as m
            return Parser(Language(m.language()))
        if lang == "tsx":
            import tree_sitter_typescript as m
            return Parser(Language(m.language_tsx()))
        if lang == "typescript":
            import tree_sitter_typescript as m
            return Parser(Language(m.language_typescript()))
        if lang == "javascript":
            import tree_sitter_javascript as m
            return Parser(Language(m.language()))
        if lang == "python":
            import tree_sitter_python as m
            return Parser(Language(m.language()))
        if lang == "go":
            import tree_sitter_go as m
            return Parser(Language(m.language()))
    except Exception:  # grammar unavailable: the file simply yields no symbols
        return None
    return None


def grammar_for(path: str) -> str | None:
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return {"java": "java", "kt": "kotlin", "kts": "kotlin", "ts": "typescript", "mts": "typescript", "tsx": "tsx",
            "js": "javascript", "jsx": "javascript", "mjs": "javascript", "cjs": "javascript", "py": "python", "go": "go"}.get(ext)


CLASS_TYPES = {
    "java": {"class_declaration": "class", "interface_declaration": "interface", "enum_declaration": "enum", "record_declaration": "record"},
    "kotlin": {"class_declaration": "class", "object_declaration": "class"},
    "typescript": {"class_declaration": "class", "abstract_class_declaration": "class", "interface_declaration": "interface",
                   "enum_declaration": "enum", "type_alias_declaration": "interface"},
    "javascript": {"class_declaration": "class"},
    "python": {"class_definition": "class"},
    "go": {},
}
CLASS_TYPES["tsx"] = CLASS_TYPES["typescript"]
CALL_TYPES = {"method_invocation", "call_expression", "call"}
UPPER = re.compile(r"^[A-Z][A-Za-z0-9_]*$")
_CALLEE = re.compile(r"^(?:this\.|self\.)?([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*$")


class _Src:
    def __init__(self, data: bytes):
        self.b = data

    def t(self, n: Node | None) -> str:
        return self.b[n.start_byte:n.end_byte].decode("utf-8", "replace") if n is not None else ""


def _walk(n: Node):
    stack = [n]
    while stack:
        cur = stack.pop()
        yield cur
        stack.extend(reversed(cur.named_children))


def _first(n: Node, types: set[str]) -> Node | None:
    for c in n.named_children:
        if c.type in types:
            return c
    return None


def _type_names(n: Node | None, s: _Src) -> list[str]:
    """Capitalised identifiers in a type expression: `List<BlogDraft>` -> [List, BlogDraft]."""
    if n is None:
        return []
    out = []
    for c in _walk(n):
        if c.type in ("type_identifier", "identifier", "simple_identifier") and c.child_count == 0:
            txt = s.t(c)
            if UPPER.match(txt):
                out.append(txt)
    return out


def _main_type(n: Node | None, s: _Src) -> str | None:
    """`Map<String, X>` -> Map; `Observable<D[]>` -> Observable; `DraftService` -> DraftService. Skips generic wrappers
    when the interesting type is the argument (Optional<X>, List<X>, Provider<X>)."""
    names = _type_names(n, s)
    if not names:
        return None
    wrappers = {"Optional", "List", "Set", "Collection", "Iterable", "Provider", "Lazy", "ObjectProvider", "Annotated", "Mono", "Flux"}
    for t in names:
        if t not in wrappers:
            return t
    return names[-1]


# ------------------------------------------------------------------ per-language details
def _annotations(node: Node, lang: str, s: _Src) -> tuple[list[str], list[str]]:
    names, texts = [], []
    holders: list[Node] = []
    if lang in ("java", "kotlin"):
        mods = _first(node, {"modifiers"})
        if mods is not None:
            holders.append(mods)
    elif lang in ("typescript", "tsx", "javascript"):
        holders.append(node)
        if node.parent is not None and node.parent.type == "export_statement":
            holders.append(node.parent)
    elif lang == "python":
        if node.parent is not None and node.parent.type == "decorated_definition":
            holders.append(node.parent)
    for h in holders:
        for c in h.named_children:
            if c.type in ("annotation", "marker_annotation", "decorator"):
                txt = s.t(c)
                texts.append(txt)
                m = re.match(r"@\s*([\w.]+)", txt)
                if m:
                    names.append(m.group(1).split(".")[-1])
    return names, texts


def _bases(node: Node, lang: str, s: _Src) -> list[str]:
    out: list[str] = []
    if lang == "java":
        for f in ("superclass", "interfaces"):
            out += _type_names(node.child_by_field_name(f), s)
        out += _type_names(_first(node, {"extends_interfaces", "super_interfaces"}), s)
    elif lang == "kotlin":
        out += _type_names(_first(node, {"delegation_specifiers", "delegation_specifier"}), s)
    elif lang in ("typescript", "tsx", "javascript"):
        out += _type_names(_first(node, {"class_heritage", "extends_type_clause"}), s)
    elif lang == "python":
        sup = node.child_by_field_name("superclasses")
        if sup is not None:
            out += [s.t(c).split(".")[-1] for c in sup.named_children if c.type in ("identifier", "attribute")]
            out += [s.t(c).split("[")[0].split(".")[-1] for c in sup.named_children if c.type == "subscript"]
    return list(dict.fromkeys(out))


def _deps(body: Node | None, node: Node, lang: str, s: _Src) -> dict[str, str]:
    deps: dict[str, str] = {}
    if lang == "java" and body is not None:
        for c in body.named_children:
            if c.type == "field_declaration":
                t = _main_type(c.child_by_field_name("type"), s)
                for d in c.named_children:
                    if d.type == "variable_declarator" and t:
                        deps[s.t(d.child_by_field_name("name"))] = t
            elif c.type == "constructor_declaration":
                params = c.child_by_field_name("parameters")
                for p in (params.named_children if params is not None else []):
                    if p.type == "formal_parameter":
                        t = _main_type(p.child_by_field_name("type"), s)
                        if t:
                            deps.setdefault(s.t(p.child_by_field_name("name")), t)
        if node.type == "record_declaration":
            params = node.child_by_field_name("parameters")
            for p in (params.named_children if params is not None else []):
                t = _main_type(p.child_by_field_name("type"), s)
                if t:
                    deps.setdefault(s.t(p.child_by_field_name("name")), t)
    elif lang == "kotlin":
        for c in _walk(node):
            if c.type in ("class_parameter", "property_declaration"):
                ident = _first(c, {"identifier", "simple_identifier", "variable_declaration"})
                name = s.t(ident).split(":")[0].strip() if ident is not None else ""
                t = _main_type(_first(c, {"user_type", "nullable_type"}) or (ident if ident is not None and ident.type == "variable_declaration" else None), s)
                if name and t:
                    deps.setdefault(name, t)
            if c.type == "function_declaration":
                continue
    elif lang in ("typescript", "tsx", "javascript") and body is not None:
        for c in body.named_children:
            if c.type == "method_definition" and s.t(c.child_by_field_name("name")) == "constructor":
                params = c.child_by_field_name("parameters")
                for p in (params.named_children if params is not None else []):
                    pat = p.child_by_field_name("pattern")
                    t = _main_type(p.child_by_field_name("type"), s)
                    if pat is not None and t:
                        deps[s.t(pat)] = t
            elif c.type in ("public_field_definition", "field_definition"):
                name = s.t(c.child_by_field_name("name"))
                t = _main_type(c.child_by_field_name("type"), s)
                val = c.child_by_field_name("value")
                if val is not None and val.type == "call_expression" and s.t(val.child_by_field_name("function")) == "inject":
                    t = _main_type(val.child_by_field_name("arguments"), s) or t  # Angular inject(DraftService)
                if name and t:
                    deps[name] = t
    elif lang == "python" and body is not None:
        for c in _walk(body):
            if c.type == "function_definition" and s.t(c.child_by_field_name("name")) == "__init__":
                params = c.child_by_field_name("parameters")
                for p in (params.named_children if params is not None else []):
                    if p.type in ("typed_parameter", "typed_default_parameter"):
                        name = s.t(_first(p, {"identifier"}))
                        t = _main_type(p.child_by_field_name("type"), s)
                        if name and t:
                            deps[name] = t
            elif c.type == "assignment" and c.parent is not None and c.parent.type == "expression_statement" and c.parent.parent is body:
                left, t = c.child_by_field_name("left"), _main_type(c.child_by_field_name("type"), s)
                if left is not None and t:
                    deps[s.t(left)] = t
    return deps


def _calls(scope: Node, s: _Src, lang: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for c in _walk(scope):
        if c.type not in CALL_TYPES:
            continue
        if lang == "java" and c.type == "method_invocation":
            obj, name = c.child_by_field_name("object"), c.child_by_field_name("name")
            if obj is not None and name is not None:
                recv = s.t(obj).removeprefix("this.")
                if re.match(r"^[A-Za-z_$][\w$]*$", recv):
                    out.append((recv, s.t(name)))
            continue
        fn = c.child_by_field_name("function")
        if fn is None and c.named_children:
            fn = c.named_children[0]
        m = _CALLEE.match(s.t(fn)) if fn is not None else None
        if m:
            out.append((m.group(1), m.group(2)))
    return out


def _type_refs(scope: Node, s: _Src, lang: str) -> set[str]:
    out: set[str] = set()
    kinds = {"type_identifier"} if lang in ("java", "typescript", "tsx", "go") else {"identifier", "simple_identifier", "type_identifier"}
    for c in _walk(scope):
        if c.type in kinds and c.child_count == 0:
            txt = s.t(c)
            if UPPER.match(txt) and len(txt) > 1:
                out.add(txt)
        elif lang in ("java", "javascript", "typescript", "tsx") and c.type in ("identifier",) and c.child_count == 0:
            txt = s.t(c)
            if UPPER.match(txt) and len(txt) > 1:
                out.add(txt)  # static calls (Foo.bar()), `new Foo()` in JS, JSX <Foo/>
    return out


def _imports(root: Node, s: _Src, lang: str) -> list[str]:
    names: list[str] = []
    for c in root.named_children:
        if lang in ("typescript", "tsx", "javascript") and c.type == "import_statement":
            clause = _first(c, {"import_clause"})
            if clause is not None:
                names += [s.t(x) for x in _walk(clause) if x.type == "identifier"]
        elif lang == "python" and c.type in ("import_from_statement", "import_statement"):
            names += [s.t(x).split(".")[-1] for x in c.named_children[1:] if x.type in ("dotted_name", "aliased_import", "identifier")]
    return [n.split(" as ")[0].strip() for n in names if n]


def _import_specs(root: Node, s: _Src, lang: str) -> list[list[str]]:
    """Where imports come from: '../lib/api' (JS/TS) or ['app.agents.llm.get_llm', 'app.agents.llm'] (Python)."""
    out: list[list[str]] = []
    for c in root.named_children:
        if lang in ("typescript", "tsx", "javascript") and c.type == "import_statement":
            src = c.child_by_field_name("source")
            if src is not None:
                out.append([s.t(src).strip("'\"`")])
        elif lang == "python" and c.type == "import_from_statement":
            mod = s.t(c.child_by_field_name("module_name"))
            names = [s.t(x).split(" as ")[0].strip() for x in c.named_children[1:] if x.type in ("dotted_name", "aliased_import")]
            for n in names or [""]:
                out.append([f"{mod}{'' if mod.endswith('.') else '.'}{n}", mod] if n else [mod])
        elif lang == "python" and c.type == "import_statement":
            out += [[s.t(x).split(" as ")[0].strip()] for x in c.named_children if x.type in ("dotted_name", "aliased_import")]
    return out


def _has_jsx(root: Node) -> bool:
    return any(c.type in ("jsx_element", "jsx_self_closing_element", "jsx_fragment") for c in _walk(root))


# ------------------------------------------------------------------ entry point
def extract(path: str, content: str) -> list[Symbol]:
    lang = grammar_for(path)
    parser = _parser(lang) if lang else None
    if parser is None:
        return []
    data = content.encode("utf-8", "replace")
    try:
        tree = parser.parse(data)
    except Exception:
        return []
    s = _Src(data)
    root = tree.root_node
    family = "typescript" if lang == "tsx" else lang
    out: list[Symbol] = []
    class_types = CLASS_TYPES.get(lang, {})
    inside_classes: list[tuple[int, int]] = []

    for n in _walk(root):
        if len(out) >= MAX_SYMBOLS_PER_FILE:
            break
        kind = class_types.get(n.type)
        if kind is None and lang == "go" and n.type == "type_spec":
            t = n.child_by_field_name("type")
            if t is not None and t.type in ("struct_type", "interface_type"):
                kind = "class" if t.type == "struct_type" else "interface"
        if kind is None:
            continue
        name_node = n.child_by_field_name("name") or _first(n, {"identifier", "type_identifier", "simple_identifier"})
        name = s.t(name_node)
        if not name:
            continue
        body = n.child_by_field_name("body") or _first(n, {"class_body", "enum_body", "interface_body", "block", "object_type"})
        ann, ann_text = _annotations(n, lang, s)
        sym = Symbol(name=name, kind=kind, lang=family, file=path, line=n.start_point[0] + 1, end_line=n.end_point[0] + 1,
                     annotations=ann, annotation_text=ann_text, bases=_bases(n, lang, s), deps=_deps(body, n, lang, s))
        if lang == "go" and kind == "class":
            st = n.child_by_field_name("type")
            for f in _walk(st):
                if f.type == "field_declaration":
                    t = _main_type(f.child_by_field_name("type"), s)
                    for fn in f.named_children:
                        if fn.type == "field_identifier" and t:
                            sym.deps[s.t(fn)] = t
        scope = body if body is not None else n
        sym.calls = _calls(scope, s, lang)
        sym.type_refs = _type_refs(scope, s, lang) | set(sym.bases) | set(sym.deps.values())
        sym.type_refs.discard(name)
        for m in _walk(scope):
            if m.type in ("method_declaration", "method_definition", "function_definition", "function_declaration"):
                mn = s.t(m.child_by_field_name("name"))
                if mn:
                    sym.methods.append(mn)
                mann, _ = _annotations(m, "python" if lang == "python" else lang, s)
                if lang in ("java", "kotlin"):
                    mods = _first(m, {"modifiers"})
                    mann = [re.match(r"@\s*([\w.]+)", s.t(a)).group(1).split(".")[-1] for a in (mods.named_children if mods is not None else [])
                            if a.type in ("annotation", "marker_annotation") and re.match(r"@\s*([\w.]+)", s.t(a))]
                sym.method_annotations += mann
        sym.jsx = lang in ("tsx", "javascript") and _has_jsx(scope)
        out.append(sym)
        inside_classes.append((n.start_byte, n.end_byte))

    # Go: attach methods (func (s *X) Foo()) to their struct for calls/type refs
    if lang == "go":
        by_name = {x.name: x for x in out}
        for n in root.named_children:
            if n.type == "method_declaration":
                recv = _main_type(n.child_by_field_name("receiver"), s) or (_type_names(n.child_by_field_name("receiver"), s) or [None])[0]
                tgt = by_name.get(recv or "")
                if tgt is not None:
                    tgt.calls += _calls(n, s, lang)
                    tgt.type_refs |= _type_refs(n, s, lang)
                    tgt.methods.append(s.t(n.child_by_field_name("name")))

    # module symbol: top-level code outside classes that does real work
    # a top-level statement that is (or only wraps) a class/interface belongs to that symbol, not to the module
    top_level = [c for c in root.named_children
                 if not any(c.start_byte <= a and b <= c.end_byte and c.type in ("export_statement", "decorated_definition") or (a <= c.start_byte and c.end_byte <= b)
                            for a, b in inside_classes)]
    meaningful = [c for c in top_level if c.type not in ("import_statement", "import_from_statement", "import_declaration", "package_declaration",
                                                         "package_clause", "comment", "expression_statement", "line_comment", "block_comment")
                  or (c.type == "expression_statement" and _first(c, {"call_expression", "call", "assignment", "await_expression"}) is not None)]
    if meaningful and lang not in ("java", "kotlin"):
        stem = posixpath.basename(path).rsplit(".", 1)[0]
        if stem in ("index", "__init__", "main", "page", "route", "layout", "mod") and "/" in path:
            stem = f"{posixpath.basename(posixpath.dirname(path))}/{stem}"
        mod = Symbol(name=stem, kind="module", lang=family, file=path, line=1, end_line=root.end_point[0] + 1)
        scope_nodes = top_level
        for c in scope_nodes:
            mod.calls += _calls(c, s, lang)
            mod.type_refs |= _type_refs(c, s, lang)
            ann, ann_text = _annotations(c, lang, s) if c.type in ("decorated_definition",) else ([], [])
            if c.type == "decorated_definition":
                for d in c.named_children:
                    if d.type == "decorator":
                        mod.annotation_text.append(s.t(d))
                        mm = re.match(r"@\s*([\w.]+)", s.t(d))
                        if mm:
                            mod.annotations.append(mm.group(1).split(".")[-1])
            for f in _walk(c):
                if f.type in ("function_declaration", "function_definition") and f.parent is not None and f.parent.type in ("program", "module", "export_statement", "decorated_definition", "source_file"):
                    nm = s.t(f.child_by_field_name("name"))
                    if nm:
                        mod.methods.append(nm)
        mod.imports = _imports(root, s, lang)
        mod.import_specs = _import_specs(root, s, lang)
        mod.jsx = lang in ("tsx", "javascript") and _has_jsx(root)
        # Depends(get_db) style injection in FastAPI handlers
        for m in re.finditer(r"Depends\(\s*([A-Za-z_][\w.]*)", content):
            mod.deps.setdefault(m.group(1).split(".")[-1], m.group(1).split(".")[-1])
        out.append(mod)
    specs = _import_specs(root, s, lang)
    for sym in out:
        if sym.kind != "module":
            sym.imports = _imports(root, s, lang)
            sym.import_specs = specs
    return out
