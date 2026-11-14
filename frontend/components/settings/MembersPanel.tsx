"use client";
import { Check, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, Card, ErrorBanner, InfoBanner, LoadingBlock, Spinner, cn, inputCls } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { OrgMember, Role } from "@/lib/types";

const ROLES: Role[] = ["owner", "admin", "member"];

export function MembersPanel() {
  const { can } = useApp();
  const list = useAsync(() => api.members(), []);
  const canManage = can("manage_members");

  return (
    <div className="space-y-3">
      {!canManage && <InfoBanner>Only owners can change roles, assign teams or remove members (needs manage_members).</InfoBanner>}
      {list.loading && !list.data && <LoadingBlock label="Loading members…" />}
      {list.error != null && <ErrorBanner error={list.error} onRetry={list.reload} />}
      {list.data && (
        <Card className="divide-y divide-line">
          {list.data.map((m) => (
            <MemberRow key={m.user_id} member={m} canManage={canManage} onChanged={(u) => list.setData((cur) => cur && cur.map((x) => (x.user_id === u.user_id ? u : x)))} onRemoved={() => list.setData((cur) => cur && cur.filter((x) => x.user_id !== m.user_id))} />
          ))}
        </Card>
      )}
    </div>
  );
}

function MemberRow({ member, canManage, onChanged, onRemoved }: { member: OrgMember; canManage: boolean; onChanged: (m: OrgMember) => void; onRemoved: () => void }) {
  const { me } = useApp();
  const isSelf = member.user_id === me.user.id;
  const [role, setRole] = useState<Role>(member.role);
  const [team, setTeam] = useState(member.team ?? "");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = role !== member.role || team.trim() !== (member.team ?? "");
  const disabled = !canManage || isSelf;

  const save = async () => {
    setBusy("save"); setError(null);
    try {
      const body: { role?: Role; team?: string | null } = {};
      if (role !== member.role) body.role = role;
      if (team.trim() !== (member.team ?? "")) body.team = team.trim() || null;
      onChanged(await api.updateMember(member.user_id, body));
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("remove"); setError(null);
    try { await api.removeMember(member.user_id); onRemoved(); }
    catch (e) { setError(errorMessage(e)); setBusy(null); setConfirm(false); }
  };

  return (
    <div className="p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="truncate font-medium">{member.name}</span>{isSelf && <Badge tone="brand">you</Badge>}</div>
          <div className="truncate text-[12px] text-muted">{member.email}</div>
        </div>
        <select aria-label={`Role of ${member.name}`} value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={disabled}
          title={isSelf ? "You cannot change your own role" : canManage ? undefined : "Requires manage_members (owner)"} className={cn(inputCls, "w-28")}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input aria-label={`Team of ${member.name}`} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="no team" disabled={!canManage} className={cn(inputCls, "w-32")} />
        {dirty && <Button size="sm" disabled={busy !== null} onClick={() => void save()}>{busy === "save" ? <Spinner className="h-3 w-3 text-[#0a0b10]" /> : <Check className="h-3 w-3" />}Save</Button>}
        {confirm ? (
          <span className="flex items-center gap-1.5">
            <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void remove()}>{busy === "remove" && <Spinner className="h-3 w-3" />}Remove</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" disabled={disabled || busy !== null} aria-label={`Remove ${member.name}`} onClick={() => setConfirm(true)}
            title={isSelf ? "You cannot remove yourself" : canManage ? "Remove member" : "Requires manage_members (owner)"}><Trash2 className="h-3.5 w-3.5" /></Button>
        )}
      </div>
      {error && <ErrorBanner error={error} className="mt-2" />}
    </div>
  );
}
