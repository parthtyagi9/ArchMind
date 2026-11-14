"use client";
import { Ban, Check, Clock, Eye, FilePlus, GitCompareArrows, Lock, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Card, PageHeader, cn, type Tone } from "@/components/ui";
import type { AuditEvent } from "@/lib/types";

const META: Record<AuditEvent["type"], { label: string; tone: Tone; icon: typeof Check }> = {
  "memory.created": { label: "Proposed", tone: "warn", icon: FilePlus },
  "memory.approved": { label: "Approved", tone: "ok", icon: Check },
  "memory.rejected": { label: "Rejected", tone: "bad", icon: X },
  "memory.corrected": { label: "Corrected", tone: "info", icon: Pencil },
  "memory.revoked": { label: "Revoked", tone: "bad", icon: Ban },
  "memory.expired": { label: "Expired", tone: "neutral", icon: Clock },
  retrieval: { label: "Retrieval", tone: "neutral", icon: Eye },
  "agent.decision": { label: "Agent decision", tone: "brand", icon: GitCompareArrows },
  "authz.denied": { label: "Access denied", tone: "bad", icon: Lock },
};

const GROUPS = [
  { id: "all", label: "All", match: () => true },
  { id: "lifecycle", label: "Memory lifecycle", match: (t: string) => t.startsWith("memory.") },
  { id: "agent", label: "Agent decisions", match: (t: string) => t === "agent.decision" || t === "retrieval" },
  { id: "authz", label: "Access", match: (t: string) => t === "authz.denied" },
];

export function HistoryView() {
  const { events, memories, setView, setFocusMemoryId } = useApp();
  const [g, setG] = useState("all");
  const group = GROUPS.find((x) => x.id === g) ?? GROUPS[0];
  const list = events.filter((e) => group.match(e.type));

  return (
    <>
      <PageHeader title="Decision History" sub="Append-only audit trail of memory approvals, corrections, revocations, access decisions and agent decisions." />
      <div className="mb-3 flex gap-1">
        {GROUPS.map((x) => <button key={x.id} onClick={() => setG(x.id)} className={cn("rounded-md px-2.5 py-1.5 text-xs", g === x.id ? "bg-brand-soft text-brand" : "text-muted hover:bg-line/50")}>{x.label}</button>)}
      </div>
      <Card className="p-2">
        <ol>
          {list.map((e) => {
            const m = META[e.type];
            const mem = memories.find((x) => x.id === e.memoryId);
            return (
              <li key={e.id} className="flex gap-3 rounded-lg px-3 py-2.5 hover:bg-line/30">
                <div className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", m.tone === "ok" ? "bg-ok-soft text-ok" : m.tone === "bad" ? "bg-bad-soft text-bad" : m.tone === "warn" ? "bg-warn-soft text-warn" : m.tone === "info" ? "bg-info-soft text-info" : m.tone === "brand" ? "bg-brand-soft text-brand" : "bg-line/60 text-muted")}>
                  <m.icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={m.tone}>{m.label}</Badge>
                    {mem && <button onClick={() => { setFocusMemoryId(mem.id); setView("memory"); }} className="truncate font-medium hover:text-brand">{mem.title}</button>}
                    <span className="ml-auto font-mono text-[11px] text-muted">{e.at}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{e.detail}</p>
                  <p className="text-[11px] text-muted/70">by {e.actor}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}
