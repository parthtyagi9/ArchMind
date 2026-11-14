"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Clock, Database, History, Pencil, Search, Trash2 } from "lucide-react";
import { api, type AuditEvent, type Me, type Memory } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, cn, fmt, inputCls, statusTone } from "./ui";

const TOOLS = ["repair_secret_access", "restart_service", "rotate_secret"];

export function MemoryInspector({ me }: { me: Me }) {
  const [all, setAll] = useState<Memory[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [hist, setHist] = useState<Memory[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ content: "", resolution_action: "", reason: "" });
  const [q, setQ] = useState("payment service can't read its database password from Secrets Manager");
  const [hits, setHits] = useState<Memory[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const admin = me.roles.includes("memory_admin");

  const load = useCallback(() => api<Memory[]>("/memories").then(setAll).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const lineages = useMemo(() => {
    const m = new Map<string, Memory[]>();
    all.forEach((x) => m.set(x.memory_id, [...(m.get(x.memory_id) ?? []), x]));
    return [...m.entries()].map(([id, vs]) => {
      const sorted = vs.sort((a, b) => a.version - b.version);
      return { id, current: sorted.find((v) => v.status === "active") ?? sorted[sorted.length - 1], versions: sorted.length };
    });
  }, [all]);

  const open = useCallback(async (id: string) => {
    setSel(id); setEditing(false);
    const [h, ev] = await Promise.all([api<Memory[]>(`/memories/${id}/history`), api<AuditEvent[]>(`/audit?memory_id=${id}`)]);
    setHist(h); setEvents(ev);
  }, []);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setErr(null);
    try { await fn(); await load(); if (sel) await open(sel); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const current = hist.find((h) => h.status === "active") ?? hist[hist.length - 1];
  const expired = (m: Memory) => new Date(m.expires_at) < new Date();

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Test governed retrieval" icon={<Search className="h-4 w-4" />} sub={`$vectorSearch pre-filtered to ${me.tenant_id}, active, unexpired`} />
          <div className="space-y-2 p-4">
            <textarea rows={3} className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button size="sm" className="w-full" loading={busy === "search"}
              onClick={() => act("search", async () => setHits(await api<Memory[]>("/memories/search", { body: { query: q } })))}>
              <Search className="h-3.5 w-3.5" />Search as {me.tenant_name}
            </Button>
            {hits && (hits.length === 0 ? <p className="text-xs text-muted">No governed matches.</p> : hits.map((h) => (
              <button key={h._id} onClick={() => open(h.memory_id)} className="flex w-full items-center justify-between rounded-md bg-panel-2 px-2 py-1.5 text-left text-xs hover:bg-line/50">
                <span className="font-mono text-brand">{h.memory_id} v{h.version}</span><span className="font-mono text-muted">{h.score?.toFixed(3)}</span>
              </button>)))}
          </div>
        </Card>
        <Card>
          <CardHeader title={`${me.tenant_name} memories`} icon={<Database className="h-4 w-4" />} sub="Only your tenant's memories are visible" />
          <ul className="divide-y divide-line">
            {lineages.map(({ id, current: c, versions }) => (
              <li key={id}>
                <button onClick={() => open(id)} className={cn("w-full px-4 py-2.5 text-left hover:bg-panel-2", sel === id && "bg-panel-2")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs">{id}</span>
                    <Badge tone={expired(c) && c.status === "active" ? "bad" : statusTone(c.status)}>{expired(c) && c.status === "active" ? "expired" : c.status}</Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">{c.service} · {c.resolution_action ?? "—"} · v{c.version}{versions > 1 ? ` of ${versions}` : ""}</p>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        {!current ? <p className="p-6 text-sm text-muted">Select a memory to inspect its provenance and history.</p> : (
          <>
            <CardHeader title={current.memory_id} icon={<History className="h-4 w-4" />} sub={`owner ${current.tenant_id} · ${current.memory_type}`}
              right={admin && current.status === "active" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(true); setDraft({ content: current.content ?? "", resolution_action: current.resolution_action ?? "", reason: "" }); }}>
                    <Pencil className="h-3.5 w-3.5" />Correct</Button>
                  <Button size="sm" variant="outline" loading={busy === "inv"} onClick={() => act("inv", () => api(`/memories/${current.memory_id}/invalidate`, { body: { reason: "invalidated from inspector" } }))}>
                    <Ban className="h-3.5 w-3.5" />Invalidate</Button>
                  <Button size="sm" variant="danger" loading={busy === "purge"} onClick={() => confirm("Purge removes content and embeddings for ALL versions. Continue?") && act("purge", () => api(`/memories/${current.memory_id}/purge`, { body: { reason: "purged from inspector" } }))}>
                    <Trash2 className="h-3.5 w-3.5" />Purge</Button>
                </div>
              )} />
            <div className="space-y-4 p-4">
              {!admin && <p className="text-xs text-muted">Correct / invalidate / purge require Super Admin (you are {me.role}).</p>}
              {err && <p className="text-xs text-bad">{err}</p>}
              {editing && (
                <div className="space-y-2 rounded-lg border border-brand/40 bg-brand-soft p-3">
                  <Field label="Corrected content (re-embedded on save)"><textarea rows={4} className={inputCls} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Resolution action">
                      <select className={inputCls} value={draft.resolution_action} onChange={(e) => setDraft({ ...draft, resolution_action: e.target.value })}>
                        <option value="">(unchanged)</option>{TOOLS.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </Field>
                    <Field label="Reason"><input className={inputCls} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button size="sm" loading={busy === "correct"} onClick={() => act("correct", async () => {
                      await api(`/memories/${current.memory_id}/correct`, { body: { content: draft.content, resolution_action: draft.resolution_action || null, reason: draft.reason } });
                      setEditing(false);
                    })}>Save as new version</Button>
                  </div>
                </div>
              )}
              <p className="text-sm leading-relaxed">{current.content ?? <span className="text-muted italic">content purged (tombstone only)</span>}</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs md:grid-cols-4">
                {[["Status", <Badge key="s" tone={statusTone(current.status)}>{current.status}</Badge>],
                  ["Verification", <Badge key="v" tone={statusTone(current.verification_status)}>{current.verification_status}{current.verification_count ? ` ×${current.verification_count}` : ""}</Badge>],
                  ["Resolution", current.resolution_action ?? "—"], ["Confidence", current.confidence?.toFixed(2)],
                  ["Source incident", current.source_incident_id ?? "—"], ["Source run", current.source_run_id ?? "—"],
                  ["Created", fmt(current.created_at)], ["Updated", fmt(current.updated_at)],
                  ["Expires", <span key="e" className={cn(expired(current) && "text-bad")}><Clock className="mr-1 inline h-3 w-3" />{fmt(current.expires_at)}</span>],
                  ["Retrievals", current.retrieval_count ?? 0], ["Last retrieved", fmt(current.last_retrieved_at)], ["Created by", current.created_by ?? "—"],
                ].map(([k, v]) => (<div key={k as string}><div className="text-muted">{k}</div><div className="font-mono">{v}</div></div>))}
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Versions</h4>
                <div className="space-y-2">
                  {hist.map((h) => (
                    <div key={h._id} className={cn("rounded-lg border border-line p-2.5 text-xs", h.status !== "active" && "opacity-60")}>
                      <div className="flex items-center justify-between"><span className="font-mono">v{h.version} · {h._id}</span><Badge tone={statusTone(h.status)}>{h.status}</Badge></div>
                      <p className="mt-1 text-muted line-clamp-2">{h.content ?? "(purged)"}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Audit</h4>
                {events.length === 0 ? <p className="text-xs text-muted">No governance events yet.</p> : events.map((e) => (
                  <div key={e._id} className="flex justify-between py-0.5 font-mono text-[11px]"><span>{e.event_type} · {e.actor}</span><span className="text-muted">{fmt(e.created_at)}</span></div>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
