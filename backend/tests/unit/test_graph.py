from app import code
from app.agents.keywords import keywords
from app.services.provenance import ticket_keys


FILES = {
    "services/auth/src/index.ts": 'import { validate } from "./validate";\nimport { authorize } from "@acme/authz";\nexport const x = 1;',
    "services/auth/src/validate.ts": 'import jwt from "jsonwebtoken";\nexport function validate() {}',
    "services/payments/src/index.ts": 'import { authorize } from "@acme/authz";\nimport { write } from "./ledger/write";\nimport db from "../../../db/client";',
    "services/payments/src/ledger/write.ts": 'import { pool } from "../../../../db/client";',
    "packages/authz/package.json": '{"name": "@acme/authz"}',
    "packages/authz/src/index.ts": "export function authorize() {}",
    "db/client.ts": "export default {}",
    "db/migrations/001.sql": "CREATE TABLE a (id int);",
}


def edges(g):
    return {(e["from"], e["to"]): e["weight"] for e in g["edges"]}


def test_components_and_cross_component_edges_from_real_imports():
    g = code.build_graph(FILES)
    ids = {n["id"] for n in g["nodes"]}
    assert {"services~auth", "services~payments", "packages~authz", "db"} <= ids
    e = edges(g)
    assert e[("services~auth", "packages~authz")] == 1       # workspace package import via package.json name
    assert e[("services~payments", "packages~authz")] == 1
    assert e[("services~payments", "db")] == 2               # relative ../../ imports resolved
    assert ("services~auth", "services~auth") not in e       # intra-component imports are not edges


def test_kinds_and_stats():
    g = {n["id"]: n for n in code.build_graph(FILES)["nodes"]}
    assert g["packages~authz"]["kind"] == "package" and g["services~auth"]["kind"] == "service"
    assert g["services~auth"]["file_count"] == 2 and g["services~auth"]["loc"] > 0 and "typescript" in g["services~auth"]["languages"]


def test_python_imports_absolute_relative_and_from_import():
    files = {
        "backend/app/main.py": "from app.api import routes\nfrom app.memory.repository import create\nimport app.config",
        "backend/app/api/routes.py": "from ..memory import repository\nfrom . import helpers",
        "backend/app/api/helpers.py": "",
        "backend/app/memory/repository.py": "def create(): pass",
        "backend/app/config.py": "",
    }
    g = code.build_graph(files)
    res = code.Resolver(files)
    assert res.resolve("backend/app/main.py", "python", ["app.memory.repository.create", "app.memory.repository"]) == "backend/app/memory/repository.py"
    assert res.resolve("backend/app/api/routes.py", "python", ["..memory.repository", "..memory"]) == "backend/app/memory/repository.py"
    assert res.resolve("backend/app/api/routes.py", "python", [".helpers"]) == "backend/app/api/helpers.py"
    assert res.resolve("backend/app/main.py", "python", ["json"]) is None   # stdlib / external


def test_alias_imports_resolve_against_package_root():
    files = {"frontend/app/page.tsx": 'import { A } from "@/components/A";', "frontend/components/A.tsx": "export const A = 1;"}
    res = code.Resolver(files)
    assert res.resolve("frontend/app/page.tsx", "typescript", ["@/components/A"]) == "frontend/components/A.tsx"


def test_big_directory_is_split_into_components():
    files = {f"frontend/{d}/f{i}.ts": "x" for d in ("app", "lib", "components") for i in range(15)}
    files["backend/a.py"] = "x"
    comps = set(code.assign_components(list(files)).values())
    assert {"frontend/app", "frontend/lib", "frontend/components", "backend"} <= comps


def test_should_index_skips_vendor_lockfiles_binaries_and_big_files():
    assert code.should_index("src/a.ts", 100, 1000)
    assert not code.should_index("node_modules/x/a.js", 100, 1000)
    assert not code.should_index("package-lock.json", 100, 1000)
    assert not code.should_index("logo.png", 100, 1000)
    assert not code.should_index("src/huge.ts", 5000, 1000)


def test_keywords_are_code_aware_and_deterministic():
    kw = keywords("audience: EXPECTED_AUD,\n clockTolerance: 5", "validate.ts", "Why does this exist?")
    assert "audience" in kw and "clock" in kw and "tolerance" in kw and "exist" not in kw
    assert keywords("audience audience expected") == keywords("audience audience expected")


def test_ticket_keys_found_in_commit_and_pr_text():
    assert ticket_keys("fix(auth): AUTH-311 reject wrong aud", "Closes PLAT-88, see AUTH-311", None) == ["AUTH-311", "PLAT-88"]
