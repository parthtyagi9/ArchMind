"use client";
import { ArrowRight, Equal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Card, CardHeader, Label, PageHeader, cn } from "@/components/ui";
import { runAgent } from "@/lib/agent";
import { liveCompare, type EvidenceItem, type LiveRun } from "@/lib/live";
import { SCENARIOS } from "@/lib/mock";
import type { Run } from "@/lib/types";

export function CompareView() {
  const { user, memories, live } = useApp();
  const [sid, setSid] = useState(SCENARIOS[0].id);
  const s = SCENARIOS.find((x) => x.id === sid) ?? SCENARIOS[0];

  const preview = useMemo(() => [runAgent(s, false, user, memories), runAgent(s, true, user, memories)] as const, [s, user, memories]);
  const [liveRes, setLiveRes] = useState<Record<string, { off: LiveRun; on: LiveRun }>>({});
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setLiveRes({}); }, [user.id]);
  const runLive = async () => {
    // Identical simulated evidence for both arms (union of the scenario's code/Jira/Confluence sources).
    const seen = new Set<string>();
    const evidence: EvidenceItem[] = [...preview[0].answer.sources, ...preview[1].answer.sources]
      .filter((x) => !seen.has(x.ref) && seen.add(x.ref))
      .map((x) => ({ kind: x.kind, ref: x.ref, title: x.label, detail: x.snippet ?? "" }));
    setRunning(true); setErr(null);
    try { const r = await liveCompare(s.question, evidence); setLiveRes((m) => ({ ...m, [s.id]: { off: r.off, on: r.on } })); }
    catch (e) { setErr((e as Error).message); } finally { setRunning(false); }
  };
  const lr = live ? liveRes[s.id] : undefined;
  const off: Run = lr?.off ?? preview[0];
  const on: Run = lr?.on ?? preview[1];
  const changed = off.answer.decision !== on.answer.decision;

  const usedMemories = on.retrieved.filter((r) => r.used);

  return (
    <>
      <PageHeader title="Memory Impact Comparison" sub="Same question, same repository state, same model and tools. Only the memory condition differs." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {SCENARIOS.map((x) => <button key={x.id} onClick={() => setSid(x.id)} className={cn("rounded-md px-3 py-1.5 text-xs", sid === x.id ? "bg-brand-soft text-brand" : "bg-panel-2 text-muted hover:text-fg")}>{x.label}</button>)}
        {live && (
          <button onClick={runLive} disabled={running} className="ml-auto rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
            {running ? "Running both arms live…" : lr ? "Re-run live comparison" : "Run live comparison"}
          </button>
        )}
      </div>
      {live && (
        <p className="-mt-2 mb-4 text-[11px] text-muted">
          {lr ? <>Live result · runs {lr.off.id} / {lr.on.id} · model {(lr.on as LiveRun).model}{(lr.off as LiveRun).model !== (lr.on as LiveRun).model ? " (warning: arms used different models due to fallback; re-run)" : ""}</>
              : "Showing the scripted preview. Run the live comparison to execute both arms against Atlas memory and the reasoning model."}
          {err && <span className="text-bad"> · {err}</span>}
        </p>
      )}

      <Card className={cn("mb-4 flex flex-wrap items-center gap-3 p-4", changed ? "border-ok/40" : "border-warn/40")}>
        {changed ? <ArrowRight className="h-5 w-5 text-ok" /> : <Equal className="h-5 w-5 text-warn" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{changed ? "Decision changed because of memory" : "No change in decision"}</div>
          <p className="text-xs text-muted">
            {changed
              ? <>From <span className="font-mono text-fg">{off.answer.decision}</span> to <span className="font-mono text-fg">{on.answer.decision}</span>{usedMemories.length ? <> using {usedMemories.map((m) => `${m.title} (v${m.version})`).join(", ")}</> : null}.</>
              : "With memory enabled the agent reached the same decision as without it. This is reported as-is: no applicable approved memory was available to " + user.name + "."}
          </p>
        </div>
        <Badge tone="info">{s.question}</Badge>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Arm title="Without memory" run={off} />
        <Arm title="With governed memory" run={on} highlight={changed} />
      </div>

      <Card className="mt-4">
        <CardHeader title="Controlled variables" />
        <div className="grid gap-3 p-4 text-xs sm:grid-cols-4">
          {[["Question", "identical"], ["Repository state", "main @ 3f9c2e1"], ["Model & temperature", "same · temp 0"], ["Tools", "same allowlist"]].map(([k, v]) => (
            <div key={k}><Label>{k}</Label>{v}</div>
          ))}
        </div>
      </Card>
    </>
  );
}

function Arm({ title, run, highlight }: { title: string; run: Run; highlight?: boolean }) {
  const a = run.answer;
  return (
    <Card className={cn(highlight && "border-ok/40")}>
      <CardHeader title={title} sub={run.id} right={<Badge tone="brand" className="font-mono">{a.decision}</Badge>} />
      <div className="space-y-3 p-4 text-[13px] leading-relaxed">
        <div className="text-sm font-semibold">{a.decisionLabel}</div>
        <div><Label>Recommendation</Label><p>{a.recommendation}</p></div>
        <div>
          <Label>Memory retrieved</Label>
          {run.retrieved.length ? run.retrieved.slice(0, 3).map((r) => <div key={r.id} className="flex items-center gap-2 py-0.5 text-xs"><Badge tone={r.used ? "ok" : "neutral"}>{r.used ? "used" : "seen"}</Badge>{r.title}<span className="ml-auto font-mono text-muted">v{r.version}</span></div>) : <span className="text-xs text-muted">none</span>}
        </div>
        <div>
          <Label>Constraints</Label>
          {a.constraints.length ? <ul className="list-disc space-y-0.5 pl-4 text-xs">{a.constraints.map((c) => <li key={c}>{c}</li>)}</ul> : <span className="text-xs text-muted">none</span>}
        </div>
        <div className="flex gap-2 text-xs"><Badge tone={a.requiresApproval ? "warn" : "neutral"}>{a.requiresApproval ? "requires approval" : "no approval needed"}</Badge><Badge>{a.confidence} confidence</Badge></div>
      </div>
    </Card>
  );
}
