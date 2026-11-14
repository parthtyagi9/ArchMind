"use client";
import { Check, Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, Card, CardHeader, Empty, ErrorBanner, Field, InfoBanner, LoadingBlock, Spinner, inputCls } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { Invite } from "@/lib/types";

export function InvitesPanel() {
  const { can } = useApp();
  const canManage = can("manage_integrations");
  const list = useAsync(() => api.invites(), [], canManage);

  if (!canManage) return <InfoBanner>Only admins and owners can create and manage invites (needs manage_integrations).</InfoBanner>;
  return (
    <div className="space-y-4">
      <CreateInvite onCreated={(inv) => list.setData((cur) => [inv, ...(cur ?? [])])} />
      <Card>
        <CardHeader title="Active invites" sub="Share a code; the person enters it when creating an account or signing in with GitHub" />
        <div className="p-3">
          {list.loading && !list.data && <LoadingBlock label="Loading invites…" />}
          {list.error != null && <ErrorBanner error={list.error} onRetry={list.reload} />}
          {list.data && list.data.length === 0 && <Empty>No invites yet. Create one above.</Empty>}
          <div className="space-y-2">
            {list.data?.map((inv) => <InviteRow key={inv.code} invite={inv} onRevoked={() => list.setData((cur) => cur && cur.filter((x) => x.code !== inv.code))} />)}
          </div>
        </div>
      </Card>
    </div>
  );
}

function CreateInvite({ onCreated }: { onCreated: (i: Invite) => void }) {
  const [role, setRole] = useState<"admin" | "member">("member");
  const [team, setTeam] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onCreated(await api.createInvite({ role, ...(team.trim() ? { team: team.trim() } : {}), expires_days: days })); setTeam(""); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="Create invite" />
      <form onSubmit={(e) => void submit(e)} className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Role">
            <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as "admin" | "member")}><option value="member">member</option><option value="admin">admin</option></select>
          </Field>
          <Field label="Team (optional)"><input className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="e.g. platform" /></Field>
          <Field label="Expires in">
            <select className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}</select>
          </Field>
        </div>
        {error && <ErrorBanner error={error} />}
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner className="h-3 w-3 text-[#0a0b10]" />}Create invite</Button>
      </form>
    </Card>
  );
}

function InviteRow({ invite, onRevoked }: { invite: Invite; onRevoked: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creator = typeof invite.created_by === "string" ? invite.created_by : invite.created_by?.name;

  const copy = async () => {
    try { await navigator.clipboard.writeText(invite.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setError("Could not copy automatically. Select the code and copy it manually."); }
  };
  const revoke = async () => {
    setBusy(true); setError(null);
    try { await api.deleteInvite(invite.code); onRevoked(); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <code className="select-all rounded bg-bg px-2 py-1 font-mono text-[13px] text-brand">{invite.code}</code>
        <Badge tone="brand">{invite.role}</Badge>
        {invite.team && <Badge>team {invite.team}</Badge>}
        <span className="text-[12px] text-muted">expires {fmtDate(invite.expires_at)} · used {invite.uses}×{creator ? ` · by ${creator}` : ""}</span>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void copy()}>{copied ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}{copied ? "Copied" : "Copy code"}</Button>
          <Button size="sm" variant="ghost" disabled={busy} aria-label="Revoke invite" title="Revoke invite" onClick={() => void revoke()}>{busy ? <Spinner className="h-3 w-3" /> : <Trash2 className="h-3.5 w-3.5" />}</Button>
        </div>
      </div>
      {error && <ErrorBanner error={error} className="mt-2" />}
    </div>
  );
}
