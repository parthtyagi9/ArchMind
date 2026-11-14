"use client";
import { Boxes, Check, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { GroupModal } from "@/components/ide/GroupModal";
import { Badge, Button, ErrorBanner, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { groupRepos } from "@/lib/groupData";
import type { Group } from "@/lib/types";

export function GroupCard({ group }: { group: Group }) {
  const { can, repos, openGroup, removeGroupLocal } = useApp();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = can("connect_repo");
  const members = groupRepos(group, repos);
  const ready = members.filter((r) => r.status === "ready");
  const indexing = members.filter((r) => r.status === "indexing").length;
  const files = ready.reduce((s, r) => s + r.file_count, 0);

  const remove = async () => {
    setBusy(true); setError(null);
    try { await api.deleteGroup(group.id); removeGroupLocal(group.id); }
    catch (e) { setError(errorMessage(e)); setBusy(false); setConfirm(false); }
  };

  return (
    <div className="flex flex-col rounded-xl border border-line bg-panel/80 p-4">
      <div className="flex items-start gap-2">
        <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" title={group.name}>{group.name}</div>
          {group.description && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{group.description}</p>}
        </div>
        <Badge tone="brand">{members.length} repo{members.length === 1 ? "" : "s"}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {members.length === 0 && <span className="text-[12px] text-muted">No repositories yet. Open the group to add or connect some.</span>}
        {members.map((r) => (
          <Badge key={r.id} tone={r.status === "ready" ? "neutral" : r.status === "failed" ? "bad" : "info"} className="max-w-full font-mono">
            <span className="truncate">{r.full_name}</span>{r.status !== "ready" && ` · ${r.status}`}
          </Badge>
        ))}
      </div>
      <div className="mt-2 text-[12px] text-muted">{files.toLocaleString()} files indexed{indexing > 0 ? ` · ${indexing} still indexing` : ""}</div>

      {error && <ErrorBanner error={error} className="mt-3" />}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button size="sm" onClick={() => openGroup(group.id)}>Open</Button>
        <Button size="sm" variant="outline" disabled={!canManage} onClick={() => setEditing(true)} title={canManage ? undefined : "Requires the connect_repo permission (admin or owner)"}>
          <Pencil className="h-3 w-3" />Edit
        </Button>
        {confirm ? (
          <span className="ml-auto flex items-center gap-1.5 text-[12px]">
            <span className="text-muted">Delete group?</span>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3" />}Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto" disabled={!canManage} onClick={() => setConfirm(true)} aria-label="Delete group"
            title={canManage ? "Delete group (its repositories stay connected; group-scoped memories stop being retrieved)" : "Requires the connect_repo permission"}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {editing && <GroupModal group={group} onClose={() => setEditing(false)} />}
    </div>
  );
}
