// Read a user-selected folder or file in the browser. Nothing is uploaded anywhere.
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "__pycache__", ".venv", "venv", "target", ".idea", ".vscode", "coverage"]);
const TEXT_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "py", "go", "rs", "java", "kt", "c", "h", "cpp", "cs", "rb", "php", "sql", "sh", "yml", "yaml", "toml", "css", "html", "txt", "env", "gradle", "swift"]);
const MAX_BYTES = 300_000;
const MAX_FILES = 500;

export async function readFolder(list: FileList): Promise<{ name: string; files: Record<string, string>; skipped: number }> {
  const files: Record<string, string> = {};
  let name = "folder";
  let skipped = 0;
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split("/");
    name = parts[0] || name;
    const path = parts.slice(1).join("/") || f.name;
    const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
    const isText = TEXT_EXT.has(ext) || ["CODEOWNERS", "Dockerfile", "Makefile", "LICENSE"].includes(f.name);
    if (parts.slice(1, -1).some((p) => SKIP_DIRS.has(p)) || !isText || f.size > MAX_BYTES || Object.keys(files).length >= MAX_FILES) { skipped++; continue; }
    files[path] = await f.text();
  }
  return { name, files, skipped };
}

export async function readSingleFile(f: File): Promise<{ name: string; files: Record<string, string> }> {
  return { name: f.name, files: { [f.name]: await f.text() } };
}
