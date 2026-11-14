"use client";
import { PageGuide } from "@/components/views/GovernanceGuide";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { AUTHORITY_LABEL, SOURCE_LABEL, TYPE_LABEL, scopeLabel } from "@/components/memoryBits";
import { Badge, Button, Card, Empty, ErrorBanner, ExtLink, InfoBanner, Label, LoadingBlock, PageHeader, Spinner, inputCls, textareaCls } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { Memory } from "@/lib/types";

export function ApprovalsView() {
  const { can, refreshPending, openMemory } = useApp();
  const list = useAsync(() => api.memories({ status: "pending" }), []);
  const canApprove = can("approve_memory");

  const resolved = (id: string) => { list.setData((cur) => cur && cur.filter((m) => m.memory_id !== id)); void refreshPending(); };

  return (
    <>
      <PageHeader title="Approval Center" sub="Proposed knowledge stays pending until a human approves it. Only active memories can influence agent decisions." />
      <PageGuide page="approvals" />
      {!canApprove && <InfoBanner className="mb-4">You can review proposals but not approve or reject them: that needs the approve_memory permission (admin or owner). The backend enforces this rule.</InfoBanner>}
      {list.loading && !list.data && <LoadingBlock label="Loading pending memories…" />}
      {list.error != null && <ErrorBanner error={list.error} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && <Empty>Nothing is waiting for review. Proposals from members and “Propose as memory” on agent answers appear here.</Empty>}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.data?.map((m) => <PendingCard key={m.version_id} m={m} canApprove={canApprove} onResolved={() => resolved(m.memory_id)} onOpen={() => openMemory(m.memory_id)} />)}
      </div>
    </>
  );
}

function PendingCard({ m, canApprove, onResolved, onOpen }: { m: Memory; canApprove: boolean; onResolved: () => void; onOpen: () => void }) {
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [content, setContent] = useState(m.content);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const why = canApprove ? undefined : "Requires the approve_memory permission";

  const approve = async () => {
    setBusy("approve"); setError(null);
    try {
      await api.approveMemory(m.memory_id, {
        ...(editing && content.trim() !== m.content ? { content: content.trim() } : {}),
        ...(editing && title.trim() !== m.title ? { title: title.trim() } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onResolved();
    } catch (e) { setError(errorMessage(e)); setBusy(null); }
  };
  const reject = async () => {
    if (!reason.trim()) return;
    setBusy("reject"); setError(null);
    try { await api.rejectMemory(m.memory_id, reason.trim()); onResolved(); }
    catch (e) { setError(errorMessage(e)); setBusy(null); }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {editing ? <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" /> : <button onClick={onOpen} className="text-left text-sm font-semibold hover:text-brand">{m.title}</button>}
          <div className="mt-1.5 flex flex-wrap gap-1.5"><Badge>{TYPE_LABEL[m.memory_type]}</Badge><Badge tone={AUTHORITY_LABEL[m.authority].tone}>{AUTHORITY_LABEL[m.authority].label}</Badge><Badge>{scopeLabel(m)}</Badge></div>
        </div>
        <Badge tone="warn">pending</Badge>
      </div>

      {editing ? <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} aria-label="Content" className={`mt-3 ${textareaCls}`} /> : <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed">{m.content}</p>}

      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <Label>Evidence</Label>
          {m.source_refs.length === 0 ? <span className="text-muted">No source references attached.</span> : m.source_refs.map((s, i) => (
            <div key={`${s.id}-${i}`} className="flex items-center gap-1.5 py-0.5">
              <Badge>{SOURCE_LABEL[s.type]}</Badge>
              {s.url ? <ExtLink href={s.url} className="truncate font-mono">{s.id}</ExtLink> : <span className="truncate font-mono text-brand">{s.id}</span>}
            </div>
          ))}
        </div>
        <div>
          <Label>Would apply to</Label>
          {m.components.length ? <div className="flex flex-wrap gap-1">{m.components.map((c) => <Badge key={c} tone="brand" className="font-mono">{c}</Badge>)}</div> : <span className="text-muted">No specific component</span>}
          <div className="mt-2 text-[11px] text-muted">Proposed by {m.created_by.name} · {fmtDate(m.created_at)}</div>
        </div>
      </div>

      {(editing || rejecting) && (
        <div className="mt-3"><Label>{rejecting ? "Reason for rejecting (required)" : "Note (optional)"}</Label><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      )}
      {error && <ErrorBanner error={error} className="mt-3" />}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        {rejecting ? (
          <>
            <Button size="sm" variant="danger" disabled={!canApprove || !reason.trim() || busy !== null} title={why} onClick={() => void reject()}>{busy === "reject" ? <Spinner className="h-3 w-3" /> : <X className="h-3.5 w-3.5" />}Confirm reject</Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ok" disabled={!canApprove || busy !== null || (editing && !content.trim())} title={why} onClick={() => void approve()}>{busy === "approve" ? <Spinner className="h-3 w-3" /> : <Check className="h-3.5 w-3.5" />}{editing ? "Approve edited" : "Approve"}</Button>
            {editing
              ? <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setTitle(m.title); setContent(m.content); }}>Cancel edit</Button>
              : <Button size="sm" variant="outline" disabled={!canApprove} title={why} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
            <Button size="sm" variant="danger" disabled={!canApprove || busy !== null} title={why} onClick={() => { setRejecting(true); setEditing(false); }}><X className="h-3.5 w-3.5" />Reject</Button>
          </>
        )}
      </div>
    </Card>
  );
}
