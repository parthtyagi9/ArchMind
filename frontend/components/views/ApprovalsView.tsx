"use client";
import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { AUTHORITY_LABEL, SOURCE_LABEL, TYPE_LABEL } from "@/components/memoryBits";
import { Badge, Button, Card, Empty, Label, PageHeader } from "@/components/ui";
import { isVisible } from "@/lib/agent";
import { NODES } from "@/lib/mock";

export function ApprovalsView() {
  const { user, memories, updateMemory, log, gov, govError } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const pending = memories.filter((m) => m.status === "pending" && isVisible(m, user));

  const approve = async (id: string, content?: string) => {
    const m = memories.find((x) => x.id === id);
    if (!m) return;
    if (await gov.approve(id, content)) { setEditing(null); return; }
    const at = new Date().toISOString().slice(0, 16).replace("T", " ");
    const text = content ?? m.content;
    updateMemory(id, (x) => ({
      ...x, status: "approved", content: text, approvedBy: user.name, authority: "verified",
      history: x.history.map((h) => (h.version === x.version ? { ...h, status: "approved" as const, content: text, at, by: user.name, note: content ? "Edited and approved" : "Approved" } : h)),
    }));
    log({ type: "memory.approved", actor: user.name, memoryId: id, detail: `Approved v${m.version}${content ? " with edits" : ""}; embedding generated; now eligible for retrieval` });
    setEditing(null);
  };

  const reject = async (id: string) => {
    if (await gov.reject(id)) return;
    updateMemory(id, (x) => ({ ...x, status: "rejected", history: x.history.map((h) => (h.version === x.version ? { ...h, status: "rejected" as const } : h)) }));
    log({ type: "memory.rejected", actor: user.name, memoryId: id, detail: "Rejected; never eligible for retrieval" });
  };

  return (
    <>
      {govError && <div className="mb-3 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{govError}</div>}
      <PageHeader title="Approval Center" sub="Agent-proposed knowledge stays pending until a human approves it. Only approved memories can influence future agent decisions." />
      {!user.canApprove && <div className="mb-4 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">{user.name} can review proposals but cannot approve them. The backend enforces this rule, not the UI.</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        {pending.map((m) => (
          <Card key={m.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{m.title}</div>
                <div className="mt-1 flex flex-wrap gap-1.5"><Badge>{TYPE_LABEL[m.type]}</Badge><Badge tone={AUTHORITY_LABEL[m.authority].tone}>{AUTHORITY_LABEL[m.authority].label}</Badge><Badge>{m.scope === "team" ? `team: ${m.team}` : m.scope}</Badge></div>
              </div>
              <Badge tone="warn">pending</Badge>
            </div>

            {editing === m.id ? (
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} className="mt-3 w-full rounded-lg border border-line bg-panel-2 p-2.5 text-xs outline-none focus:border-brand" />
            ) : (
              <p className="mt-3 text-[13px] leading-relaxed">{m.content}</p>
            )}

            <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <Label>Evidence</Label>
                {m.sources.map((s) => <div key={s.id} className="flex items-center gap-1.5 py-0.5"><Badge>{SOURCE_LABEL[s.type]}</Badge><span className="truncate font-mono text-brand">{s.id}</span></div>)}
              </div>
              <div>
                <Label>Would apply to</Label>
                <div className="flex flex-wrap gap-1">{m.components.map((c) => <Badge key={c} tone="brand">{NODES.find((n) => n.id === c)?.label ?? c}</Badge>)}</div>
              </div>
            </div>

            <div className="mt-4 flex gap-2 border-t border-line pt-3">
              {editing === m.id ? (
                <>
                  <Button size="sm" variant="ok" disabled={!user.canApprove} onClick={() => approve(m.id, draft.trim() || m.content)}><Check className="h-3.5 w-3.5" />Approve edited</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ok" disabled={!user.canApprove} onClick={() => approve(m.id)}><Check className="h-3.5 w-3.5" />Approve</Button>
                  <Button size="sm" variant="outline" disabled={!user.canApprove} onClick={() => { setEditing(m.id); setDraft(m.content); }}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                  <Button size="sm" variant="danger" disabled={!user.canApprove} onClick={() => reject(m.id)}><X className="h-3.5 w-3.5" />Reject</Button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
      {pending.length === 0 && <Empty>Nothing waiting for review.</Empty>}
    </>
  );
}
