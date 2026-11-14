// Tiny line-based syntax highlighter. Good enough for a preview; not a real tokenizer.
const KW = new Set((
  "import from export default const let var function return async await if else for while new class interface type extends implements try catch finally throw " +
  "def lambda pass with as in is not and or None True False self SELECT FROM WHERE INSERT INTO VALUES UPDATE SET CREATE TABLE PRIMARY KEY NOT NULL DEFAULT REFERENCES CHECK ORDER BY DESC LIMIT BEGIN COMMIT ROLLBACK RETURNING " +
  "public private static void int string boolean func package struct fn let mut use pub impl"
).split(" "));

const RE = /(\/\/.*$|#.*$|--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)(\s*\()?/g;

export type Tok = { t: string; c: "plain" | "comment" | "string" | "number" | "keyword" | "fn" | "type" };

export function highlightLine(line: string, lang: string): Tok[] {
  if (lang === "md") {
    if (/^#{1,6}\s/.test(line)) return [{ t: line, c: "keyword" }];
    return [{ t: line, c: "plain" }];
  }
  if (lang === "json") lang = "ts";
  const out: Tok[] = [];
  let last = 0;
  line.replace(RE, (m: string, com, str, num, id, paren, off: number) => {
    if (off > last) out.push({ t: line.slice(last, off), c: "plain" });
    if (com) {
      // `#` is only a comment in py/sh; `--` only in sql; `//` in c-like.
      const ok = (com.startsWith("//") && lang !== "py" && lang !== "sql") || (com.startsWith("#") && (lang === "py" || lang === "sh")) || (com.startsWith("--") && lang === "sql");
      out.push({ t: com, c: ok ? "comment" : "plain" });
    } else if (str) out.push({ t: str, c: "string" });
    else if (num) out.push({ t: num, c: "number" });
    else if (id) {
      if (KW.has(id)) { out.push({ t: id, c: "keyword" }); if (paren) out.push({ t: paren, c: "plain" }); }
      else if (paren) { out.push({ t: id, c: "fn" }); out.push({ t: paren, c: "plain" }); }
      else if (/^[A-Z][A-Za-z0-9]*$/.test(id) && !/^[A-Z_]+$/.test(id)) out.push({ t: id, c: "type" });
      else out.push({ t: id, c: "plain" });
    }
    last = off + m.length;
    return m;
  });
  if (last < line.length) out.push({ t: line.slice(last), c: "plain" });
  return out;
}

export const langOf = (path: string) => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "java", "go", "rs", "c", "cpp", "cs"].includes(ext)) return "ts";
  if (ext === "py") return "py";
  if (ext === "sql") return "sql";
  if (ext === "md") return "md";
  if (ext === "json") return "json";
  if (["sh", "yml", "yaml", "toml"].includes(ext)) return "sh";
  return "text";
};

export const TOKEN_CLASS: Record<Tok["c"], string> = {
  plain: "text-[#c9cde0]",
  comment: "text-[#6b7290] italic",
  string: "text-[#a5e3a0]",
  number: "text-[#f5b97a]",
  keyword: "text-[#c792ea]",
  fn: "text-[#82aaff]",
  type: "text-[#ffcb6b]",
};
