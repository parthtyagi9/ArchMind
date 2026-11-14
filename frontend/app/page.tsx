"use client";
import { useEffect, useState } from "react";
import { Activity, Database, FlaskConical, LogOut, ScrollText, ShieldCheck } from "lucide-react";
import { api, ApiError, type DemoUser, type Me, type Run } from "@/lib/api";
import { AuditTimeline } from "@/components/AuditTimeline";
import { Experiment } from "@/components/Experiment";
import { MemoryInspector } from "@/components/MemoryInspector";
import { Workspace } from "@/components/Workspace";
import { Badge, Button, Card, cn } from "@/components/ui";

const TABS = [
  { id: "workspace", label: "Incident workspace", icon: Activity },
  { id: "memory", label: "Memory inspector", icon: Database },
  { id: "experiment", label: "Memory A/B", icon: FlaskConical },
  { id: "audit", label: "Audit", icon: ScrollText },
] as const;

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("workspace");
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [health, setHealth] = useState<{ status: string; mongodb?: { ok: boolean }; llm_model?: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<Me>("/session/me").then(setMe).catch((e) => { if (!(e instanceof ApiError)) console.error(e); }).finally(() => setLoaded(true));
    api<DemoUser[]>("/session/users").then(setUsers).catch(() => {});
    api<typeof health>("/health").then(setHealth).catch(() => setHealth({ status: "down" }));
  }, []);

  const login = async (user_id: string) => { setMe(await api<Me>("/session/login", { body: { user_id } })); setLastRun(null); };
  const logout = async () => { await api("/session/logout", { body: {} }); setMe(null); };

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand to-ok/80"><ShieldCheck className="h-5 w-5 text-white" /></div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">RecallOps</h1>
            <p className="text-xs text-muted">Incident response agent that learns, remembers, and forgets responsibly</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {health && <Badge tone={health.mongodb?.ok ? "ok" : "bad"}>Atlas {health.mongodb?.ok ? "connected" : "unreachable"}</Badge>}
          {health?.llm_model && <Badge tone="brand">{health.llm_model}</Badge>}
          <Badge tone="warn">simulated AWS · demo identity</Badge>
          {me && (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5">
              <div className="text-right"><div className="text-xs font-medium">{me.name}</div><div className="text-[11px] text-muted">{me.tenant_name} · {me.roles.join(", ")}</div></div>
              <Button size="sm" variant="ghost" onClick={logout}><LogOut className="h-3.5 w-3.5" /></Button>
            </div>
          )}
        </div>
      </header>

      {loaded && !me && (
        <Card className="mx-auto mt-16 max-w-lg p-6">
          <h2 className="text-base font-semibold">Sign in to a demo organization</h2>
          <p className="mt-1 text-xs text-muted">Demo-only identity: the server issues a signed session; your tenant is resolved server-side and cannot be chosen in a request.</p>
          <div className="mt-4 space-y-2">
            {users.map((u) => (
              <button key={u.user_id} onClick={() => login(u.user_id)} className="flex w-full items-center justify-between rounded-lg border border-line bg-panel-2 px-4 py-3 text-left hover:border-brand">
                <div><div className="text-sm font-medium">{u.name}</div><div className="text-xs text-muted">{u.roles.join(" · ")}</div></div>
                <Badge tone={u.tenant_name.startsWith("Alpha") ? "brand" : "ok"}>{u.tenant_name}</Badge>
              </button>
            ))}
            {users.length === 0 && <p className="text-xs text-bad">Backend unreachable at /api. Is uvicorn running on :8000?</p>}
          </div>
        </Card>
      )}

      {me && (
        <>
          <nav className="mb-4 flex gap-1 border-b border-line">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={cn("-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm", tab === id ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg")}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </nav>
          <div key={me.user_id}>
            <div className={tab === "workspace" ? "" : "hidden"}><Workspace me={me} onRun={setLastRun} /></div>
            {tab === "memory" && <MemoryInspector me={me} />}
            {tab === "experiment" && <Experiment me={me} />}
            {tab === "audit" && <AuditTimeline runId={lastRun?._id} />}
          </div>
        </>
      )}
    </div>
  );
}
