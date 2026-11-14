"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CircleSlash, Database, Play, RotateCcw, Server, ShieldCheck, X } from "lucide-react";
import { api, DEMO_INCIDENT, type Incident, type Me, type Run } from "@/lib/api";
import { RunTimeline } from "./RunTimeline";
import { Badge, Button, Card, CardHeader, Field, Json, inputCls, statusTone } from "./ui";

type SimResp = { state: { version: number; services: Record<string, { deployment_status: string; iam_role: string }>; change_log: unknown[] };
  evaluation: Record<string, { allowed: boolean; checks: Record<string, boolean> }> };

export function Workspace({ me, onRun }: { me: Me; onRun: (r: Run) => void }) {
  const [form, setForm] = useState(DEMO_INCIDENT);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [memoryOn, setMemoryOn] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sim, setSim] = useState<SimResp | null>(null);

  const loadSim = useCallback(() => api<SimResp>("/simulator").then(setSim).catch(() => {}), []);
  useEffect(() => { loadSim(); }, [loadSim, run?.status]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  const submit = () => act("run", async () => {
    const inc = await api<Incident>("/incidents", { body: form });
    setIncident(inc);
    setRun(null);
    const r = await api<Run>(`/incidents/${inc._id}/runs`, { body: { memory_enabled: memoryOn } });
    setRun(r); onRun(r);
  });
  const decide = (approve: boolean) => act(approve ? "approve" : "reject", async () => {
    const r = await api<Run>(`/runs/${run!._id}/${approve ? "approve" : "reject"}`, { body: { comment: "" } });
    setRun(r); onRun(r);
  });
  const reset = () => act("reset", async () => { await api("/simulator/reset", { body: {} }); setRun(null); await loadSim(); });

  const canApprove = me.roles.includes("approver");
  const pay = sim?.evaluation["payment-service"];

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="New incident" icon={<AlertTriangle className="h-4 w-4" />} sub={`Filed as ${me.tenant_name} (from your session)`} />
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Service">
                <select className={inputCls} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })}>
                  <option>payment-service</option><option>checkout-service</option>
                </select>
              </Field>
              <Field label="Environment"><input className={inputCls} value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} /></Field>
            </div>
            <Field label="Error code"><input className={inputCls} value={form.error_code} onChange={(e) => setForm({ ...form, error_code: e.target.value })} /></Field>
            <Field label="Description">
              <textarea rows={5} className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <label className="flex items-center justify-between rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm">
              <span className="flex items-center gap-2"><Database className="h-4 w-4 text-brand" />Use governed memory</span>
              <input type="checkbox" className="h-4 w-4 accent-[#8b5cf6]" checked={memoryOn} onChange={(e) => setMemoryOn(e.target.checked)} />
            </label>
            <Button className="w-full" onClick={submit} loading={busy === "run"}><Play className="h-4 w-4" />Submit & run agent</Button>
            {err && <p className="text-xs text-bad">{err}</p>}
          </div>
        </Card>

        <Card>
          <CardHeader title="Simulated environment" icon={<Server className="h-4 w-4" />} sub={`state v${sim?.state.version ?? "—"} · persisted in MongoDB`}
            right={<Button size="sm" variant="ghost" onClick={reset} loading={busy === "reset"}><RotateCcw className="h-3.5 w-3.5" />Reset</Button>} />
          <div className="space-y-3 p-4 text-sm">
            {sim && Object.entries(sim.state.services).map(([name, s]) => (
              <div key={name} className="flex items-center justify-between">
                <span className="font-mono text-xs">{name}</span>
                <Badge tone={s.deployment_status === "healthy" ? "ok" : "bad"}>{s.deployment_status}</Badge>
              </div>
            ))}
            {pay && (
              <div className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="text-muted">payment-service → secret access</span>
                  <Badge tone={pay.allowed ? "ok" : "bad"}>{pay.allowed ? "ALLOWED" : "DENIED"}</Badge>
                </div>
                {Object.entries(pay.checks).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between py-0.5 font-mono text-[11px]">
                    <span className="text-muted">{k}</span>{v ? <Check className="h-3.5 w-3.5 text-ok" /> : <X className="h-3.5 w-3.5 text-bad" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        {run?.status === "awaiting_approval" && run.pending_action && (
          <Card className="border-warn/50 bg-warn-soft">
            <div className="flex flex-wrap items-start justify-between gap-4 p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-warn"><ShieldCheck className="h-4 w-4" />Approval required: state-changing action</div>
                <p className="font-mono text-sm">{run.pending_action.tool}({JSON.stringify(run.pending_action.args)})</p>
                {run.pending_action.rationale && <p className="max-w-2xl text-xs text-muted">{run.pending_action.rationale}</p>}
                {!!run.pending_action.memory_ids_used?.length && (
                  <p className="text-xs"><Badge tone="brand">based on memory {run.pending_action.memory_ids_used.join(", ")}</Badge></p>
                )}
                {!canApprove && <p className="text-xs text-bad">Your role cannot approve. Sign in as an approver.</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => decide(false)} loading={busy === "reject"} disabled={!canApprove}><CircleSlash className="h-4 w-4" />Reject</Button>
                <Button variant="ok" onClick={() => decide(true)} loading={busy === "approve"} disabled={!canApprove}><Check className="h-4 w-4" />Approve & execute</Button>
              </div>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Agent run" icon={<Play className="h-4 w-4" />}
            sub={run ? `${run._id} · memory ${run.memory_enabled ? "on" : "off"}` : busy === "run" ? "Agent is reasoning…" : "Submit an incident to start"}
            right={run && <Badge tone={statusTone(run.status)}>{run.status.replace("_", " ")}</Badge>} />
          <div className="grid gap-4 p-4 xl:grid-cols-[1fr_300px]">
            <div>
              {busy === "run" && !run && <p className="animate-pulse text-sm text-muted">Classifying → retrieving memory → planning…</p>}
              {run && <RunTimeline steps={run.steps} />}
              {run?.status_reason && <p className="mt-4 text-xs text-muted">Status: {run.status_reason}</p>}
            </div>
            {run && (
              <div className="space-y-3">
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Retrieved evidence</h4>
                  {!run.memory_enabled && <p className="text-xs text-muted">Memory disabled for this run.</p>}
                  {run.memory_enabled && !run.memories?.length && <p className="text-xs text-muted">No governed memory matched.</p>}
                  <div className="space-y-2">
                    {run.memories?.map((m) => (
                      <div key={m.memory_id} className="rounded-lg border border-line bg-panel-2 p-2.5">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-mono text-[11px] text-brand">{m.memory_id} v{m.version}</span>
                          <span className="font-mono text-[11px] text-muted">{m.score?.toFixed(3)}</span>
                        </div>
                        <p className="text-xs text-muted line-clamp-4">{m.content}</p>
                        <div className="mt-1.5 flex gap-1"><Badge tone={statusTone(m.verification_status)}>{m.verification_status}</Badge>
                          {m.resolution_action && <Badge>{m.resolution_action}</Badge>}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {run.memory_result && (
                  <div><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Memory write-back</h4><Json value={run.memory_result} /></div>
                )}
              </div>
            )}
          </div>
        </Card>
        {incident && <p className="text-xs text-muted">Incident {incident._id} · tenant enforced server-side</p>}
      </div>
    </div>
  );
}
