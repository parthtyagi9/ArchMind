"use client";
import { Ban, Lock, Pencil, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppState";
import { AUTHORITY_LABEL, SOURCE_LABEL, StatusBadge, TYPE_LABEL } from "@/components/memoryBits";
import { Badge, Button, Card, CardHeader, Empty, Label, PageHeader, cn } from "@/components/ui";
import { effectiveStatus, exclusionReason, isVisible } from "@/lib/agent";
import { NODES } from "@/lib/mock";
import type { Memory, MemoryStatus } from "@/lib/types";

const FILTERS: ("all" | MemoryStatus)[] = ["all", "approved", "pending", "expired", "revoked"];

export function MemoryView() {
  const { user, memories, updateMemory, log, focusMemoryId, setFocusMemoryId } = useApp();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(focusMemoryId);
  const [mode, setMode] = useState<"view" | "correct" | "revoke">("view");
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => { if (focusMemoryId) { setSelectedId(focusMemoryId); setFocusMemoryId(null); } }, [focusMemoryId, setFocusMemoryId]);

  const mine = useMemo(() => memories.filter((m) => isVisible(m, user)), [memories, user]);
  const hidden = memories.length - mine.length;
  const list = mine.filter((m) => (filter === "all" || effectiveStatus(m) === filter) && (!q || `${m.title} ${m.content}`.toLowerCase().includes(q.toLowerCase())));
  const sel = mine.find((m) => m.id === selectedId) ?? null;

  const pick = (m: Memory) => { setSelectedId(m.id); setMode("view"); setReason(""); };

  const saveCorrection = (m: Memory) => {
    if (!draft.trim()) return;
    const at = new Date().toISOString().slice(0, 16).replace("T", " ");
    updateMemory(m.id, (x) => ({
      ...x,
      content: draft.trim(), version: x.version + 1, approvedBy: user.name, authority: "verified",
      history: [
        ...x.history.map((h) => (h.version === x.version ? { ...h, status: "superseded" as const } : h)),
        { version: x.version + 1, content: draft.trim(), status: "approved", by: user.name, at, note: reason || "Corrected" },
      ],
    }));
    log({ type: "memory.corrected", actor: user.name, memoryId: m.id, detail: `Corrected v${m.version} → v${m.version + 1}; previous version superseded; new embedding generated` });
    setMode("view");
  };

  const revoke = (m: Memory) => {
    const at = new Date().toISOString().slice(0, 16).replace("T", " ");
    updateMemory(m.id, (x) => ({
      ...x, status: "revoked", revokeReason: reason || "Revoked by reviewer",
      history: x.history.map((h) => (h.version === x.version ? { ...h, status: "revoked" as const, at, note: reason || "Revoked" } : h)),
    }));
    log({ type: "memory.revoked", actor: user.name, memoryId: m.id, detail: `Revoked: ${reason || "no reason given"}; excluded from retrieval immediately` });
    setMode("view");
  };

  return (
    <>
      <PageHeader title="Memory Inspector" sub="Every organizational memory, its authority, provenance and version history. Only memories inside your scope are listed." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories (preview: keyword match; production uses vector search)"
                className="h-9 w-full rounded-lg border border-line bg-panel-2 pl-9 pr-3 text-xs outline-none focus:border-brand" />
            </div>
            <div className="flex gap-1">
              {FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} className={cn("rounded-md px-2.5 py-1.5 text-xs capitalize", filter === f ? "bg-brand-soft text-brand" : "text-muted hover:bg-line/50")}>{f}</button>)}
            </div>
          </div>

          <div className="space-y-2">
            {list.map((m) => (
              <button key={m.id} onClick={() => pick(m)} className={cn("block w-full rounded-xl border bg-panel/80 p-3.5 text-left transition-colors hover:border-brand/60", selectedId === m.id ? "border-brand" : "border-line")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.title}</div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{m.content}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-muted">v{m.version}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge m={m} />
                  <Badge>{TYPE_LABEL[m.type]}</Badge>
                  <Badge tone={AUTHORITY_LABEL[m.authority].tone}>{AUTHORITY_LABEL[m.authority].label}</Badge>
                  <Badge>{m.scope === "team" ? `team: ${m.team}` : m.scope}</Badge>
                  {m.usedInRuns > 0 && <Badge tone="info">used in {m.usedInRuns} runs</Badge>}
                </div>
              </button>
            ))}
            {list.length === 0 && <Empty>No memories match.</Empty>}
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted"><Lock className="h-3 w-3" />{hidden} memories outside your organization or team are not retrievable and not listed.</div>
        </div>

        <Card className="h-fit xl:sticky xl:top-0">
          {!sel ? <div className="p-6 text-xs text-muted">Select a memory to see its provenance, versions and governance actions.</div> : (
            <>
              <CardHeader title={sel.title} sub={`${sel.id} · repo ${sel.repo}`} right={<StatusBadge m={sel} />} />
              <div className="space-y-4 p-4 text-[13px]">
                {(() => { const why = exclusionReason(sel, user); return why ? (
                  <div className="rounded-lg border border-bad/30 bg-bad-soft p-2.5 text-xs text-bad">Excluded from agent retrieval: {why}.{sel.revokeReason ? ` ${sel.revokeReason}` : ""}</div>
                ) : (
                  <div className="rounded-lg border border-ok/30 bg-ok-soft p-2.5 text-xs text-ok">Eligible: agents in your scope can retrieve this version.</div>
                ); })()}

                <div><Label>Current content (v{sel.version})</Label><p className="leading-relaxed">{sel.content}</p></div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><Label>Authority</Label><Badge tone={AUTHORITY_LABEL[sel.authority].tone}>{AUTHORITY_LABEL[sel.authority].label}</Badge></div>
                  <div><Label>Approved by</Label>{sel.approvedBy ?? <span className="text-muted">not yet approved</span>}</div>
                  <div><Label>Scope</Label>{sel.scope === "team" ? `team: ${sel.team}` : sel.scope}</div>
                  <div><Label>Expires</Label>{sel.expiresAt ? sel.expiresAt.slice(0, 10) : <span className="text-muted">never</span>}</div>
                </div>

                <div>
                  <Label>Provenance</Label>
                  <div className="space-y-1">
                    {sel.sources.map((s) => <div key={s.id} className="flex items-center gap-2 text-xs"><Badge>{SOURCE_LABEL[s.type]}</Badge><span className="font-mono text-brand">{s.id}</span><span className="truncate text-muted">{s.label}</span></div>)}
                  </div>
                </div>

                <div>
                  <Label>Related components</Label>
                  <div className="flex flex-wrap gap-1.5">{sel.components.map((c) => <Badge key={c} tone="brand">{NODES.find((n) => n.id === c)?.label ?? c}</Badge>)}</div>
                </div>

                <div>
                  <Label>Version history (immutable)</Label>
                  <ol className="space-y-2 border-l border-line pl-3">
                    {sel.history.slice().reverse().map((h) => (
                      <li key={h.version} className="text-xs">
                        <div className="flex items-center gap-2"><span className="font-mono">v{h.version}</span><Badge tone={h.status === "approved" ? "ok" : h.status === "superseded" ? "neutral" : h.status === "revoked" ? "bad" : "warn"}>{h.status}</Badge><span className="ml-auto text-muted">{h.at}</span></div>
                        <p className="mt-1 text-muted">{h.content}</p>
                        <p className="mt-0.5 text-[11px] text-muted/70">{h.by}{h.note ? ` · ${h.note}` : ""}</p>
                      </li>
                    ))}
                  </ol>
                </div>

                {mode === "view" && sel.status !== "pending" && (
                  <div className="flex gap-2 border-t border-line pt-3">
                    <Button size="sm" variant="outline" disabled={!user.canApprove || sel.status === "revoked"} onClick={() => { setDraft(sel.content); setMode("correct"); }}><Pencil className="h-3.5 w-3.5" />Correct</Button>
                    <Button size="sm" variant="danger" disabled={!user.canApprove || sel.status === "revoked"} onClick={() => setMode("revoke")}><Ban className="h-3.5 w-3.5" />Revoke</Button>
                    {!user.canApprove && <span className="self-center text-[11px] text-muted">Approver role required</span>}
                  </div>
                )}
                {mode === "correct" && (
                  <div className="space-y-2 border-t border-line pt-3">
                    <Label>Corrected content (creates v{sel.version + 1}, re-embedded)</Label>
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} className="w-full rounded-lg border border-line bg-panel-2 p-2.5 text-xs outline-none focus:border-brand" />
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for correction" className="h-8 w-full rounded-lg border border-line bg-panel-2 px-2.5 text-xs outline-none focus:border-brand" />
                    <div className="flex gap-2"><Button size="sm" onClick={() => saveCorrection(sel)}>Save new version</Button><Button size="sm" variant="ghost" onClick={() => setMode("view")}>Cancel</Button></div>
                  </div>
                )}
                {mode === "revoke" && (
                  <div className="space-y-2 border-t border-line pt-3">
                    <Label>Revoke: stops all future retrieval immediately</Label>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (recorded in audit log)" className="h-8 w-full rounded-lg border border-line bg-panel-2 px-2.5 text-xs outline-none focus:border-brand" />
                    <div className="flex gap-2"><Button size="sm" variant="danger" onClick={() => revoke(sel)}>Confirm revoke</Button><Button size="sm" variant="ghost" onClick={() => setMode("view")}>Cancel</Button></div>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
