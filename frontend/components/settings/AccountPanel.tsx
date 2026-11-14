"use client";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, Card, CardHeader, Field, Spinner, inputCls } from "@/components/ui";

export function AccountPanel() {
  const { me, signOut } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Account" sub="Your profile in ArchMind" />
      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input className={inputCls} value={me.user.name} readOnly /></Field>
          <Field label="Email"><input className={inputCls} value={me.user.email} readOnly /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Active organization</span><Badge tone="brand">{me.org.name}</Badge><Badge>{me.org.role}</Badge>{me.org.team && <Badge>team {me.org.team}</Badge>}
          {me.user.github_login && <Badge tone="info">GitHub: {me.user.github_login}</Badge>}
        </div>
        <p className="text-[11px] text-muted">Name and email are set when the account is created and are read-only here.</p>
        <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); void signOut(); }}>{busy ? <Spinner className="h-3.5 w-3.5" /> : <LogOut className="h-3.5 w-3.5" />}Sign out</Button>
      </div>
    </Card>
  );
}
