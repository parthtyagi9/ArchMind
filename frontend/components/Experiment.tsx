"use client";
import { useState } from "react";
import { Database, FlaskConical, Info } from "lucide-react";
import { api, DEMO_INCIDENT, type Experiment as Exp, type Incident, type Me } from "@/lib/api";
import { RunTimeline } from "./RunTimeline";
import { Badge, Button, Card, CardHeader, cn, statusTone } from "./ui";

export function Experiment({ me }: { me: Me }) {
  const [exp, setExp] = useState<Exp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canRun = me.roles.includes("approver");

  const run = async () => {
    setBusy(true); setErr(null); setExp(null);
    try {
      const inc = await api<Incident>("/incidents", { body: DEMO_INCIDENT });
      setExp(await api<Exp>(`/incidents/${inc._id}/experiment`, { body: {} }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const arms = exp ? ([["without_memory", "Without memory"], ["with_memory", "With governed memory"]] as const) : [];
  const a = exp?.arms.without_memory.metrics, b = exp?.arms.with_memory.metrics;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Controlled experiment: does memory change behavior?" icon={<FlaskConical className="h-4 w-4" />}
          sub="Same incident · same tools · same model & temperature · same approval policy · simulator reset before each arm · no memory writes"
          right={<Button onClick={run} loading={busy} disabled={!canRun}>{busy ? "Running both arms…" : "Run A/B"}</Button>} />
        {!canRun && <p className="px-4 py-2 text-xs text-bad">Requires the approver role (both arms pre-approve state-changing actions under your identity).</p>}
        {err && <p className="px-4 py-2 text-xs text-bad">{err}</p>}
        {exp && a && b && (
          <div className="grid gap-px overflow-hidden border-t border-line bg-line md:grid-cols-4">
            {[["Tool calls", a.tool_calls, b.tool_calls], ["Diagnostic calls", a.diagnostic_calls, b.diagnostic_calls],
              ["State-changing calls", a.state_changing_calls, b.state_changing_calls], ["LLM decisions", a.llm_decisions, b.llm_decisions]].map(([k, x, y]) => (
              <div key={k as string} className="bg-panel p-4">
                <div className="text-xs text-muted">{k}</div>
                <div className="mt-1 flex items-baseline gap-2 font-mono">
                  <span className="text-lg">{x}</span><span className="text-muted">→</span>
                  <span className={cn("text-lg", (y as number) < (x as number) ? "text-ok" : (y as number) > (x as number) ? "text-warn" : "")}>{y}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {exp && (
          <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-xs text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {exp.summary.same_tool_sequence
              ? "Both arms chose the identical tool sequence: memory did not change behavior on this run. Reported as measured."
              : `Memory changed the execution path (${exp.summary.tool_calls_delta >= 0 ? "+" : ""}${exp.summary.tool_calls_delta} tool calls, ${exp.summary.diagnostic_calls_delta >= 0 ? "+" : ""}${exp.summary.diagnostic_calls_delta} diagnostics). Both resolved: ${exp.summary.both_resolved ? "yes" : "no"}.`}
            <span className="ml-auto font-mono">{exp._id}</span>
          </div>
        )}
      </Card>

      {exp && (
        <div className="grid gap-4 lg:grid-cols-2">
          {arms.map(([key, label]) => {
            const arm = exp.arms[key];
            return (
              <Card key={key}>
                <CardHeader title={label} icon={key === "with_memory" ? <Database className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
                  sub={arm.run_id} right={<Badge tone={statusTone(arm.status)}>{arm.status}</Badge>} />
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap gap-1">
                    {arm.metrics.tool_sequence.map((t, i) => <Badge key={i} tone={t.startsWith("inspect") ? "neutral" : "warn"} className="font-mono">{i + 1}. {t}</Badge>)}
                  </div>
                  <p className="text-xs text-muted">Retrieved: {arm.retrieved_memory_ids.length ? arm.retrieved_memory_ids.join(", ") : "none (memory disabled)"}</p>
                  <RunTimeline steps={arm.steps} compact />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
