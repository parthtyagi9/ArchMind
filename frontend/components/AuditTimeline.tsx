"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import { api, type AuditEvent } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Json, fmt } from "./ui";

const tone = (t: string) =>
  t.includes("rejected") || t.includes("blocked") || t.includes("failed") || t.includes("purged") || t.includes("invalidated") ? "bad"
    : t.includes("approved") || t.includes("resolved") || t.includes("created") ? "ok"
    : t.includes("approval_requested") || t.includes("corrected") ? "warn" : t.startsWith("memory") ? "brand" : "neutral";

export function AuditTimeline({ runId }: { runId?: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [scope, setScope] = useState<"run" | "all">(runId ? "run" : "all");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    const qs = scope === "run" && runId ? `?run_id=${runId}` : "";
    api<AuditEvent[]>(`/audit${qs}`).then((e) => setEvents(scope === "all" ? e.slice(-150).reverse() : e)).catch(() => {});
  }, [scope, runId]);
  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader title="Audit timeline" icon={<ScrollText className="h-4 w-4" />} sub="Append-only · ids, decisions and hashes only (no memory content or secrets)"
        right={<div className="flex gap-2">
          {runId && <Button size="sm" variant={scope === "run" ? "outline" : "ghost"} onClick={() => setScope("run")}>Last run</Button>}
          <Button size="sm" variant={scope === "all" ? "outline" : "ghost"} onClick={() => setScope("all")}>All (tenant)</Button>
          <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>} />
      <ul className="divide-y divide-line">
        {events.length === 0 && <li className="p-4 text-sm text-muted">No events.</li>}
        {events.map((e) => (
          <li key={e._id} className="px-4 py-2">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === e._id ? null : e._id)}>
              <span className="w-28 shrink-0 font-mono text-[11px] text-muted">{fmt(e.created_at)}</span>
              <Badge tone={tone(e.event_type)} className="font-mono">{e.event_type}</Badge>
              <span className="text-xs text-muted">by {e.actor}</span>
              <span className="ml-auto truncate font-mono text-[11px] text-muted">{e.memory_id ?? e.run_id ?? e.incident_id}</span>
            </button>
            {open === e._id && <Json className="mt-2" value={e.details} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}
