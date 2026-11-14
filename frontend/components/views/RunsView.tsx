"use client";
import { useApp } from "@/components/AppState";
import { Badge, Card, CardHeader, Empty, Label, PageHeader, cn } from "@/components/ui";

const KIND_TONE = { deterministic: "neutral", llm: "brand", retrieval: "info" } as const;

export function RunsView() {
  const { runs, selectedRunId, setSelectedRunId } = useApp();
  const sel = runs.find((r) => r.id === selectedRunId) ?? runs[0];

  return (
    <>
      <PageHeader title="Agent Run Inspector" sub="Every run records what was retrieved, which memory versions were used, and the structured decision that came out." />
      {!sel ? <Empty>No runs yet. Ask the assistant a question.</Empty> : (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-2">
            {runs.map((r) => (
              <button key={r.id} onClick={() => setSelectedRunId(r.id)} className={cn("block w-full rounded-xl border bg-panel/80 p-3 text-left hover:border-brand/60", sel.id === r.id ? "border-brand" : "border-line")}>
                <div className="flex items-center justify-between"><span className="font-mono text-xs">{r.id}</span><span className="text-[11px] text-muted">{r.at}</span></div>
                <div className="mt-1 line-clamp-2 text-xs text-muted">{r.question}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={r.memoryInfluenced ? "ok" : "neutral"}>{r.memoryInfluenced ? "memory-informed" : r.memoryOn ? "no applicable memory" : "memory off"}</Badge>
                  <Badge tone="brand" className="font-mono">{r.answer.decision}</Badge>
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title={sel.id} sub={`${sel.userName} · ${sel.tenant} · ${sel.at}`} right={<Badge tone={sel.memoryInfluenced ? "ok" : "neutral"}>{sel.memoryInfluenced ? "memory changed context" : "baseline"}</Badge>} />
              <div className="space-y-4 p-4 text-xs">
                <div><Label>Question</Label><p className="text-[13px]">{sel.question}</p></div>
                <div>
                  <Label>Pipeline</Label>
                  <ol className="space-y-1.5">
                    {sel.steps.map((s, i) => (
                      <li key={s.name} className="flex gap-3 rounded-lg border border-line px-3 py-2">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-line/60 font-mono text-[10px]">{i + 1}</span>
                        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-medium">{s.name}</span><Badge tone={KIND_TONE[s.kind]}>{s.kind}</Badge><span className="ml-auto font-mono text-muted">{s.ms} ms</span></div><p className="mt-0.5 text-muted">{s.detail}</p></div>
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <Label>Retrieved memory ({sel.retrieved.length}) · excluded by policy: {sel.excluded}</Label>
                  {sel.retrieved.length ? sel.retrieved.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 border-b border-line/60 py-1.5 last:border-0">
                      <Badge tone={r.used ? "ok" : "neutral"}>{r.used ? "used" : "retrieved"}</Badge><span>{r.title}</span><span className="ml-auto font-mono text-muted">{r.id}@v{r.version} · score {r.score.toFixed(2)}</span>
                    </div>
                  )) : <span className="text-muted">None.</span>}
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title="Structured decision" sub="Machine-readable output validated before it is shown" />
              <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-muted">{JSON.stringify({
                decision: sel.answer.decision,
                confidence: sel.answer.confidence,
                requires_approval: sel.answer.requiresApproval,
                affected_components: sel.answer.affectedComponents,
                constraints: sel.answer.constraints,
                memory_references: sel.retrieved.filter((r) => r.used).map((r) => `${r.id}@v${r.version}`),
                source_references: sel.answer.sources.map((s) => s.ref),
              }, null, 2)}</pre>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
