"use client";
import { GitCompareArrows } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppState";
import { RunProgress } from "@/components/ide/AgentCard";
import { VerdictBadge } from "@/components/ide/AnswerCard";
import { Badge, Button, Card, CardHeader, Chip, Empty, ErrorBanner, InfoBanner, Label, LoadingBlock, PageHeader, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate, selLabel, timeAgo } from "@/lib/format";
import { useAsync, usePolling } from "@/lib/hooks";
import type { Run } from "@/lib/types";

export function RunsView() {
  const { selectedRunId, repo, group } = useApp();
  const [scope, setScope] = useState<"all" | "repo">("all");
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { if (selectedRunId) setPicked(selectedRunId); }, [selectedRunId]);
  const repoId = scope === "repo" && repo ? repo.id : undefined;
  const groupId = scope === "repo" && group ? group.id : undefined;
  const list = useAsync(() => api.runs({ repo_id: repoId, group_id: groupId, limit: 30 }), [repoId, groupId]);
  const runs = list.data ?? [];
  const activeId = picked ?? selectedRunId ?? runs[0]?.id ?? null;
  const inList = runs.find((r) => r.id === activeId) ?? null;
  // a run opened from elsewhere (audit trail, memory provenance) may be older than the list window
  const extra = useAsync(() => api.run(activeId!), [activeId], !!activeId && !inList && list.data !== null);
  const sel = inList ?? extra.data;

  return (
    <>
      <PageHeader title="Agent Run Inspector" sub="Every run records what each agent did, what memory was retrieved or withheld, and the structured decision that came out."
        right={(repo || group) && <div className="flex gap-1"><Chip active={scope === "all"} onClick={() => setScope("all")}>All runs</Chip><Chip active={scope === "repo"} onClick={() => setScope("repo")}>{repo?.full_name ?? group?.name}</Chip></div>} />
      {list.loading && !list.data && <LoadingBlock label="Loading runs…" />}
      {list.error != null && <ErrorBanner error={list.error} onRetry={list.reload} />}
      {extra.error != null && <ErrorBanner error={extra.error} onRetry={extra.reload} className="mb-3" />}
      {list.data && runs.length === 0 && !sel && <Empty>No runs yet. Select code and ask “Why does this exist?”, or type a question in the chat panel.</Empty>}
      {(runs.length > 0 || sel) && (
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-2">
            {runs.map((r) => (
              <button key={r.id} onClick={() => setPicked(r.id)} className={cn("block w-full rounded-xl border bg-panel/80 p-3 text-left hover:border-brand/60", activeId === r.id ? "border-brand" : "border-line")}>
                <div className="flex items-center justify-between"><span className="font-mono text-xs">{r.id}</span><span className="text-[11px] text-muted">{timeAgo(r.created_at)}</span></div>
                <div className="mt-1 line-clamp-2 text-xs text-muted">{r.question}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "info"}>{r.status}</Badge>
                  <Badge>{r.kind}</Badge>
                  {!r.memory_enabled && <Badge>memory off</Badge>}
                  {r.answer && <VerdictBadge verdict={r.answer.guidance.verdict} size="sm" />}
                </div>
                {r.repo_name && <div className="mt-1.5 truncate font-mono text-[10px] text-muted">{r.repo_name}</div>}
              </button>
            ))}
          </div>
          {sel && <RunDetail key={sel.id} initial={sel} />}
        </div>
      )}
    </>
  );
}

function RunDetail({ initial }: { initial: Run }) {
  const { openMemory, openCompare, can } = useApp();
  const poll = usePolling<Run>({ id: initial.id, initial, fetch: () => api.run(initial.id), keepGoing: (r) => r.status === "running", intervalMs: 600 });
  const run = poll.data ?? initial;
  const mem = run.memory;

  return (
    <div className="min-w-0 space-y-4">
      {poll.error != null && <ErrorBanner error={poll.error} onRetry={poll.retry} />}
      <Card>
        <CardHeader title={run.id} sub={`${run.user.name} · ${fmtDate(run.created_at)}${run.finished_at ? ` → ${fmtDate(run.finished_at)}` : ""}`}
          right={
            <div className="flex items-center gap-2">
              <Badge tone={run.memory_enabled ? "ok" : "neutral"}>{run.memory_enabled ? "memory on" : "memory off"}</Badge>
              <Button size="sm" variant="outline" disabled={!can("ask")} title={can("ask") ? "Re-run this question with and without memory" : "Requires the ask permission"}
                onClick={() => openCompare({ question: run.question, selection: run.selection, repoId: run.repo_id, groupId: run.group_id })}><GitCompareArrows className="h-3.5 w-3.5" />Compare with/without memory</Button>
            </div>
          } />
        <div className="space-y-4 p-4 text-xs">
          <div><Label>Question ({run.kind})</Label><p className="text-[13px]">{run.question}</p></div>
          {run.selection && <div><Label>Selection</Label><div className="font-mono text-[11px] text-brand">{run.selection.path} · {selLabel(run.selection)}</div><pre className="mt-1 max-h-40 overflow-auto rounded-md border border-line bg-bg/60 p-2 font-mono text-[11px] text-muted">{run.selection.text}</pre></div>}
          {run.repo_name ? <div className="text-muted">Repository: <span className="font-mono text-fg">{run.repo_name}</span></div> : <InfoBanner tone="info">Local files: no repository was attached, so GitHub provenance was unavailable for this run.</InfoBanner>}
          {run.status === "failed" && <ErrorBanner error={run.error ?? "The run failed without details."} />}
          <div><Label>Pipeline</Label><RunProgress run={run} expandAll /></div>
          <div>
            <Label>Memory retrieval</Label>
            <div className="mb-2 rounded-md border border-line bg-bg/40 p-2 font-mono text-[11px] text-muted">
              filter: {Object.entries(mem.filter).map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(",")}]` : String(v)}`).join(" · ")}
            </div>
            {mem.retrieved.length === 0 ? <p className="text-muted">{run.memory_enabled ? "No memories were retrieved." : "Memory was disabled for this run."}</p> : mem.retrieved.map((r) => (
              <div key={`${r.memory_id}@${r.version}`} className="flex items-center gap-2 border-b border-line/60 py-1.5 last:border-0">
                <Badge tone={r.used ? "ok" : "neutral"}>{r.used ? "used" : "retrieved"}</Badge>
                <button onClick={() => openMemory(r.memory_id)} className="min-w-0 flex-1 truncate text-left hover:text-brand">{r.title}</button>
                <span className="shrink-0 font-mono text-muted">{r.memory_id}@v{r.version} · score {r.score.toFixed(3)}</span>
              </div>
            ))}
            <div className="mt-2"><Badge tone={mem.excluded > 0 ? "warn" : "neutral"}>{mem.excluded} {mem.excluded === 1 ? "memory" : "memories"} withheld by policy</Badge></div>
          </div>
          <div><Label>Reasoning</Label><span className="text-muted">{run.reasoning.status}{run.reasoning.model ? ` · ` : ""}</span>{run.reasoning.model && <span className="font-mono">{run.reasoning.model}</span>}</div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Structured answer" sub="The machine-readable output the guidance verdict comes from" />
        {run.answer ? <pre className="max-h-[480px] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-muted">{JSON.stringify(run.answer, null, 2)}</pre> : <p className="p-4 text-xs text-muted">{run.status === "running" ? "The answer appears when the reasoning step finishes." : "This run produced no answer."}</p>}
      </Card>
    </div>
  );
}
