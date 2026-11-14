"use client";
import { Ban, Bot, Brain, Check, Clock, Eye, FilePlus, GitBranch, Lock, Pencil, ScrollText, Trash2, UserCog, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Card, Chip, Empty, ErrorBanner, LoadingBlock, PageHeader, cn, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { AuditEvent } from "@/lib/types";

const META: Record<string, { label: string; tone: Tone; icon: typeof Check }> = {
  "memory.created": { label: "Proposed", tone: "warn", icon: FilePlus },
  "memory.approved": { label: "Approved", tone: "ok", icon: Check },
  "memory.rejected": { label: "Rejected", tone: "bad", icon: X },
  "memory.corrected": { label: "Corrected", tone: "info", icon: Pencil },
  "memory.revoked": { label: "Revoked", tone: "bad", icon: Ban },
  "memory.purged": { label: "Purged", tone: "bad", icon: Trash2 },
  "memory.retrieved": { label: "Retrieved", tone: "neutral", icon: Eye },
  "memory.expired": { label: "Expired", tone: "neutral", icon: Clock },
  "agent.run": { label: "Agent run", tone: "brand", icon: Bot },
  "authz.denied": { label: "Access denied", tone: "bad", icon: Lock },
};

const FILTERS: { id: string; label: string }[] = [
  { id: "", label: "All" },
  ...Object.keys(META).map((t) => ({ id: t, label: META[t].label })),
];

const TONE_BG: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok", bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", info: "bg-info-soft text-info", brand: "bg-brand-soft text-brand", neutral: "bg-line/60 text-muted",
};

function metaOf(type: string): { label: string; tone: Tone; icon: typeof Check } {
  const known = META[type];
  if (known) return known;
  const icon = type.startsWith("auth.") ? Lock : type.startsWith("org.") ? UserCog : type.startsWith("repo.") ? GitBranch : type.startsWith("integration.") ? Brain : ScrollText;
  return { label: type, tone: "neutral", icon };
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function HistoryView() {
  const { openMemory, openRun } = useApp();
  const [type, setType] = useState("");
  const events = useAsync(() => api.audit({ limit: 200, ...(type ? { type } : {}) }), [type]);

  return (
    <>
      <PageHeader title="Decision History" sub="Append-only audit trail of memory approvals, corrections, revocations, access decisions and agent runs. Events never contain memory text, so purged memories leave no copy." />
      <div className="mb-3 flex flex-wrap gap-1">{FILTERS.map((f) => <Chip key={f.id} active={type === f.id} onClick={() => setType(f.id)}>{f.label}</Chip>)}</div>
      {events.loading && !events.data && <LoadingBlock label="Loading audit trail…" />}
      {events.error != null && <ErrorBanner error={events.error} onRetry={events.reload} />}
      {events.data && events.data.length === 0 && <Empty>No events{type ? ` of type ${type}` : ""} yet.</Empty>}
      {events.data && events.data.length > 0 && (
        <Card className="p-2">
          <ol>{events.data.map((e) => <EventRow key={e.id} e={e} onMemory={openMemory} onRun={openRun} />)}</ol>
          {events.data.length >= 200 && <p className="px-3 py-2 text-[11px] text-muted">Showing the 200 most recent events. Use the filters to narrow down.</p>}
        </Card>
      )}
    </>
  );
}

function EventRow({ e, onMemory, onRun }: { e: AuditEvent; onMemory: (id: string) => void; onRun: (id: string) => void }) {
  const m = metaOf(e.type);
  const entries = Object.entries(e.details ?? {});
  return (
    <li className="flex gap-3 rounded-lg px-3 py-2.5 hover:bg-line/30">
      <div className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", TONE_BG[m.tone])}><m.icon className="h-3.5 w-3.5" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={m.tone}>{m.label}</Badge>
          <span className="font-mono text-[11px] text-muted">{e.type}</span>
          {e.memory_id && <button onClick={() => onMemory(e.memory_id!)} className="font-mono text-[11px] text-brand hover:underline">{e.memory_id}</button>}
          {e.run_id && <button onClick={() => onRun(e.run_id!)} className="font-mono text-[11px] text-brand hover:underline">{e.run_id}</button>}
          <span className="ml-auto font-mono text-[11px] text-muted">{fmtDate(e.at)}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted/80">by {e.actor?.name ?? "system"}</p>
        {entries.length > 0 && (
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
            {entries.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words font-mono text-fg/90">{renderValue(v)}</dd></div>))}
          </dl>
        )}
      </div>
    </li>
  );
}
