"use client";
import { AlertTriangle, Ban, Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { AUTHORITY_LABEL, SOURCE_LABEL, StatusBadge, TYPE_LABEL, scopeLabel } from "@/components/memoryBits";
import { Badge, Button, Card, ErrorBanner, ExtLink, Field, InfoBanner, Label, LoadingBlock, RichText, Spinner, inputCls, textareaCls } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { Memory } from "@/lib/types";

type Mode = "approve" | "reject" | "correct" | "revoke" | "purge";

export function MemoryDetail({ memoryId, onChanged, onPurged }: { memoryId: string; onChanged: () => void; onPurged: () => void }) {
  const detail = useAsync(() => api.memory(memoryId), [memoryId]);
  const m = detail.data;
  if (detail.loading && !m) return <LoadingBlock label="Loading memory…" />;
  if (detail.error != null) return <ErrorBanner error={detail.error} onRetry={detail.reload} />;
  if (!m) return null;
  return <Body key={m.version_id} m={m} onChanged={() => { detail.reload(); onChanged(); }} onPurged={onPurged} />;
}

function Body({ m, onChanged, onPurged }: { m: Memory; onChanged: () => void; onPurged: () => void }) {
  const { can, repos, openRun, refreshPending } = useApp();
  const [mode, setMode] = useState<Mode | null>(null);
  const live = m.status === "active" || m.status === "expired";

  const done = () => { setMode(null); void refreshPending(); onChanged(); };

  const gate = (perm: Parameters<typeof can>[0], applies: boolean, why: string) =>
    !can(perm) ? `Requires the ${perm} permission (${perm === "purge_memory" ? "owner" : "admin or owner"})` : !applies ? why : null;
  const actions: { mode: Mode; label: string; icon: typeof Check; variant: "ok" | "outline" | "danger"; blocked: string | null }[] = [
    { mode: "approve", label: "Approve", icon: Check, variant: "ok", blocked: gate("approve_memory", m.status === "pending", "Only pending memories can be approved") },
    { mode: "reject", label: "Reject", icon: X, variant: "outline", blocked: gate("approve_memory", m.status === "pending", "Only pending memories can be rejected") },
    { mode: "correct", label: "Correct", icon: Pencil, variant: "outline", blocked: gate("correct_memory", live, "Only active memories can be corrected") },
    { mode: "revoke", label: "Revoke", icon: Ban, variant: "outline", blocked: gate("revoke_memory", live, "Only active memories can be revoked") },
    { mode: "purge", label: "Purge", icon: Trash2, variant: "danger", blocked: gate("purge_memory", m.status !== "purged", "Already purged") },
  ];
  const history = [...(m.history ?? [])].sort((a, b) => b.version - a.version);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-sm font-semibold">{m.title}</h2>
          <span className="font-mono text-[11px] text-muted">{m.memory_id}@v{m.version}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge status={m.status} />
          <Badge>{TYPE_LABEL[m.memory_type]}</Badge>
          <Badge tone={AUTHORITY_LABEL[m.authority].tone}>{AUTHORITY_LABEL[m.authority].label}</Badge>
          <Badge>{scopeLabel(m)}</Badge>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed"><RichText text={m.content} /></p>

        <div className={`mt-3 rounded-md border px-2.5 py-2 text-xs ${m.eligible ? "border-ok/30 bg-ok-soft text-ok" : "border-warn/30 bg-warn-soft text-warn"}`}>
          {m.eligible ? "Eligible: an agent acting for you would retrieve this right now." : `Not eligible for retrieval by you right now${m.exclusion_reason ? `: ${m.exclusion_reason}` : ""}.`}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Meta k="Approved by" v={m.approved_by?.name ?? "not approved"} />
          <Meta k="Created by" v={`${m.created_by.name} · ${fmtDate(m.created_at)}`} />
          <Meta k="Expires" v={m.expires_at ? fmtDate(m.expires_at) : "never"} />
          <Meta k="Retrieved by agents" v={`${m.retrieval_count} time${m.retrieval_count === 1 ? "" : "s"}`} />
          <Meta k="Updated" v={fmtDate(m.updated_at)} />
          {m.group_id && <Meta k="Repo group" v={m.group_name ?? m.group_id} />}
          {m.repo_id && <Meta k="Repository" v={m.repo_name ?? repos.find((r) => r.id === m.repo_id)?.full_name ?? m.repo_id} />}
        </dl>

        {m.components.length > 0 && <div className="mt-3"><Label>Applies to components</Label><div className="flex flex-wrap gap-1">{m.components.map((c) => <Badge key={c} tone="brand" className="font-mono">{c}</Badge>)}</div></div>}

        <div className="mt-3">
          <Label>Provenance ({m.source_refs.length})</Label>
          {m.source_refs.length === 0 ? <p className="text-xs text-muted">No source references were attached.</p> : (
            <ul className="space-y-1 text-xs">
              {m.source_refs.map((s, i) => (
                <li key={`${s.type}-${s.id}-${i}`} className="flex flex-wrap items-center gap-1.5">
                  <Badge>{SOURCE_LABEL[s.type]}</Badge>
                  {s.type === "agent_run" ? <button onClick={() => openRun(s.id)} className="font-mono text-brand hover:underline">{s.id}</button> : s.url ? <ExtLink href={s.url} className="font-mono">{s.id}</ExtLink> : <span className="font-mono text-brand">{s.id}</span>}
                  {s.label && s.label !== s.id && <span className="text-muted">{s.label}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <Label>Actions</Label>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a.mode} size="sm" variant={mode === a.mode ? "primary" : a.variant} disabled={!!a.blocked} title={a.blocked ?? undefined} onClick={() => setMode(mode === a.mode ? null : a.mode)}>
              <a.icon className="h-3.5 w-3.5" />{a.label}
            </Button>
          ))}
        </div>
        {actions.some((a) => a.blocked) && <p className="mt-2 text-[11px] text-muted">Greyed-out actions are unavailable for this memory or your role; hover for the reason. The backend enforces the same rules.</p>}
        {mode && <ActionForm key={mode} m={m} mode={mode} onDone={done} onPurged={onPurged} onCancel={() => setMode(null)} />}
      </Card>

      <Card className="p-4">
        <Label>Version history ({history.length || 1}) · immutable</Label>
        {history.length === 0 ? <p className="text-xs text-muted">This memory has a single version (v{m.version}).</p> : (
          <ol className="space-y-2">
            {history.map((h) => (
              <li key={h.version_id} className="rounded-lg border border-line bg-panel-2 p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono font-medium">v{h.version}</span><StatusBadge status={h.status} /><Badge tone={AUTHORITY_LABEL[h.authority].tone}>{AUTHORITY_LABEL[h.authority].label}</Badge>
                  <span className="ml-auto text-[11px] text-muted">{h.created_by.name} · {fmtDate(h.created_at)}</span>
                </div>
                {h.approved_by && <div className="mt-1 text-[11px] text-muted">approved by {h.approved_by.name}</div>}
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-muted hover:text-fg">{h.title}</summary>
                  <p className="mt-1 whitespace-pre-wrap text-fg/90">{h.content}</p>
                </details>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

const Meta = ({ k, v }: { k: string; v: string }) => <div><dt className="text-[10px] uppercase tracking-wider text-muted">{k}</dt><dd className="mt-0.5 break-words">{v}</dd></div>;

function ActionForm({ m, mode, onDone, onPurged, onCancel }: { m: Memory; mode: Mode; onDone: () => void; onPurged: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(m.title);
  const [content, setContent] = useState(m.content);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonRequired = mode !== "approve";
  const valid = (!reasonRequired || reason.trim().length > 0) && (mode !== "correct" || content.trim().length > 0) && (mode !== "purge" || ack);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      const r = reason.trim();
      if (mode === "approve") {
        await api.approveMemory(m.memory_id, { ...(content.trim() !== m.content ? { content: content.trim() } : {}), ...(title.trim() !== m.title ? { title: title.trim() } : {}), ...(r ? { reason: r } : {}) });
      } else if (mode === "reject") await api.rejectMemory(m.memory_id, r);
      else if (mode === "correct") await api.correctMemory(m.memory_id, { content: content.trim(), ...(title.trim() !== m.title ? { title: title.trim() } : {}), reason: r });
      else if (mode === "revoke") await api.revokeMemory(m.memory_id, r);
      else { await api.purgeMemory(m.memory_id, r); onPurged(); return; }
      onDone();
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-3 space-y-3 border-t border-line pt-3">
      {mode === "approve" && <InfoBanner tone="info">Approving makes this memory active and embeds it so agents can retrieve it. You may edit it first; edits are recorded in the audit trail.</InfoBanner>}
      {mode === "correct" && <InfoBanner tone="info">Correcting creates a new version (v{m.version + 1}) that becomes active and is re-embedded. The current version becomes superseded and stays in the history.</InfoBanner>}
      {mode === "revoke" && <InfoBanner>Revoking excludes this memory from retrieval immediately. History is kept, so the decision remains auditable.</InfoBanner>}
      {mode === "purge" && (
        <div className="rounded-lg border border-bad/40 bg-bad-soft p-3 text-xs text-bad">
          <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" />Irreversible delete</div>
          <p className="mt-1 leading-relaxed">Purging physically removes the content and embeddings of every version of this memory ({m.memory_id}). Only a tombstone and the audit trail remain. This cannot be undone and the text cannot be recovered.</p>
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand this permanently deletes the memory</label>
        </div>
      )}
      {(mode === "approve" || mode === "correct") && (
        <>
          <Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Content"><textarea className={textareaCls} rows={5} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
        </>
      )}
      <Field label={reasonRequired ? "Reason (required)" : "Note (optional)"}><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <ErrorBanner error={error} />}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={mode === "purge" || mode === "reject" || mode === "revoke" ? "danger" : "ok"} disabled={!valid || busy}>{busy && <Spinner className="h-3 w-3" />}Confirm {mode}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
