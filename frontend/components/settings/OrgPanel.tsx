"use client";
import { Check } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, Card, CardHeader, ErrorBanner, Field, Spinner, inputCls } from "@/components/ui";
import { errorMessage } from "@/lib/api";

export function OrgPanel() {
  const { me, switchOrg, createOrg } = useApp();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doSwitch = async (id: string) => {
    setBusy(id); setError(null);
    try { await switchOrg(id); }
    catch (e) { setError(errorMessage(e)); setBusy(null); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy("new"); setError(null);
    try { await createOrg(name.trim()); }
    catch (err) { setError(errorMessage(err)); setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Your organizations" sub="Switching changes which repositories, memories and runs you see. Everything is scoped to the active organization." />
        <div className="divide-y divide-line">
          {me.orgs.map((o) => (
            <div key={o.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
              <Badge tone="brand">{o.role}</Badge>
              {o.id === me.org.id
                ? <span className="flex items-center gap-1 text-ok"><Check className="h-3.5 w-3.5" />active</span>
                : <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void doSwitch(o.id)}>{busy === o.id && <Spinner className="h-3 w-3" />}Switch</Button>}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Create a new organization" sub="You become its owner and it becomes your active organization." />
        <form onSubmit={(e) => void create(e)} className="flex items-end gap-2 p-4">
          <div className="flex-1"><Field label="Organization name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></Field></div>
          <Button type="submit" size="sm" className="h-9" disabled={busy !== null || !name.trim()}>{busy === "new" && <Spinner className="h-3 w-3 text-[#0a0b10]" />}Create</Button>
        </form>
      </Card>
      {error && <ErrorBanner error={error} />}
    </div>
  );
}
