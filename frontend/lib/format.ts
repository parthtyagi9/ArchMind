import type { Finding, Selection } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO string -> "2026-11-14 09:41" in local time. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return fmtDate(iso).slice(0, 10);
}

export const baseName = (path: string) => path.split("/").pop() ?? path;

export function selLabel(sel: Selection): string {
  const range = sel.end_line !== sel.start_line ? `${sel.start_line}–${sel.end_line}` : `${sel.start_line}`;
  return `${baseName(sel.path)}:${range}`;
}

/** "mem_x@v2" -> "mem_x" */
export const memoryIdOfRef = (ref: string) => ref.split("@")[0];

/** "mem_x@v2" -> 2, or null when the ref has no version. */
export function memoryVersionOfRef(ref: string): number | null {
  const m = /@v(\d+)$/.exec(ref);
  return m ? Number(m[1]) : null;
}

export function findingsByRef(agents: { findings: Finding[] }[]): Map<string, Finding> {
  const m = new Map<string, Finding>();
  for (const a of agents) for (const f of a.findings) m.set(f.ref, f);
  return m;
}

export const humanize = (s: string) => s.replace(/_/g, " ");

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
