"use client";
import { ArrowRight, GitCompareArrows, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppState";
import { GuidanceBlock, VerdictBadge } from "@/components/ide/AnswerCard";
import { Badge, Button, Card, CardHeader, ErrorBanner, Field, InfoBanner, Label, PageHeader, Spinner, cn, inputCls, textareaCls } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { selLabel, timeAgo } from "@/lib/format";
import { useAsync, usePolling } from "@/lib/hooks";
import type { Answer, Compare, Selection } from "@/lib/types";

export function CompareView() {
  const { comparePrefill, repo, group, repos, groups, can } = useApp();
  const [question, setQuestion] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  // "group:<id>" or "repo:<id>" or "" for no workspace
  const [target, setTarget] = useState<string>(group ? `group:${group.id}` : repo ? `repo:${repo.id}` : "");
  const [compareId, setCompareId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runs = useAsync(() => api.runs({ limit: 30 }), []);
  const canAsk = can("ask");

  useEffect(() => {
    if (!comparePrefill) return;
    setQuestion(comparePrefill.question);
    setSelection(comparePrefill.selection);
    setTarget(comparePrefill.groupId ? `group:${comparePrefill.groupId}` : comparePrefill.repoId ? `repo:${comparePrefill.repoId}` : "");
    setCompareId(null);
  }, [comparePrefill]);

  const pickRun = (id: string) => {
    const r = runs.data?.find((x) => x.id === id);
    if (!r) return;
    setQuestion(r.question); setSelection(r.selection); setTarget(r.group_id ? `group:${r.group_id}` : r.repo_id ? `repo:${r.repo_id}` : ""); setCompareId(null);
  };

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !canAsk) return;
    setBusy(true); setError(null); setCompareId(null);
    try {
      const where = target.startsWith("group:") ? { group_id: target.slice(6) } : target.startsWith("repo:") ? { repo_id: target.slice(5) } : {};
      // a selection made in a group keeps the repository it came from
      const sel = selection && target.startsWith("group:") ? selection : selection ? { ...selection, repo_id: undefined } : null;
      const { compare_id } = await api.startCompare({ question: question.trim(), ...where, ...(sel ? { selection: sel } : {}) });
      setCompareId(compare_id);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Memory Impact" sub="Prove whether governed memory changed the agent's decision: the same evidence run and the same model, with memory removed from one arm." />
      <InfoBanner tone="info" className="mb-4">Both arms reuse one evidence-gathering run (same repository state, tickets and docs) and the same reasoning model. The only difference is whether your governed memories are in the prompt. If the decision does not change, this view says so.</InfoBanner>

      <Card className="mb-5">
        <form onSubmit={(e) => void start(e)} className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Start from a past run">
              <select className={inputCls} value="" onChange={(e) => pickRun(e.target.value)} disabled={!runs.data?.length}>
                <option value="">{runs.loading ? "Loading runs…" : runs.data?.length ? "Choose a run to copy its question and selection" : "No past runs yet"}</option>
                {runs.data?.map((r) => <option key={r.id} value={r.id}>{timeAgo(r.created_at)} · {r.question.slice(0, 60)}</option>)}
              </select>
            </Field>
            <Field label="Repository or group">
              <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">None (no GitHub provenance)</option>
                {groups.length > 0 && <optgroup label="Repo groups">{groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}</optgroup>}
                <optgroup label="Repositories">{repos.map((r) => <option key={r.id} value={`repo:${r.id}`}>{r.full_name}</option>)}</optgroup>
              </select>
            </Field>
          </div>
          <Field label="Question"><textarea className={textareaCls} rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Why does this exist? Or ask an architecture question." required /></Field>
          {selection && (
            <div className="rounded-lg border border-brand/30 bg-brand-soft p-2 text-[11px]">
              <div className="flex items-center gap-2"><span className="font-mono text-brand">{selection.path} · {selLabel(selection)}</span><button type="button" onClick={() => setSelection(null)} aria-label="Remove selection" className="ml-auto text-muted hover:text-fg"><X className="h-3 w-3" /></button></div>
              <pre className="mt-1 max-h-20 overflow-auto font-mono text-muted">{selection.text}</pre>
            </div>
          )}
          {error && <ErrorBanner error={error} />}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!canAsk || busy || !question.trim()} title={canAsk ? undefined : "Requires the ask permission"}>{busy ? <Spinner className="h-3.5 w-3.5 text-[#0a0b10]" /> : <GitCompareArrows className="h-4 w-4" />}Compare with and without memory</Button>
            {!canAsk && <span className="text-[11px] text-muted">Your role cannot ask questions.</span>}
          </div>
        </form>
      </Card>

      {compareId && <CompareResult key={compareId} id={compareId} />}
    </>
  );
}

function CompareResult({ id }: { id: string }) {
  const { openMemory, openRun } = useApp();
  const poll = usePolling<Compare>({ id, initial: null, fetch: () => api.compare(id), keepGoing: (c) => c.status === "running", intervalMs: 800 });
  const c = poll.data;

  if (poll.error != null) return <ErrorBanner error={poll.error} onRetry={poll.retry} />;
  if (!c || c.status === "running") {
    return <div role="status" className="flex items-center gap-2 rounded-xl border border-line bg-panel/80 px-4 py-6 text-xs text-muted"><Spinner />Gathering shared evidence, then reasoning twice: without memory and with memory…</div>;
  }
  if (c.status === "failed") return <ErrorBanner error={c.error ?? "The comparison failed without details."} />;

  return (
    <div className="space-y-4">
      {c.changed ? (
        <div role="status" className="rounded-xl border border-ok/40 bg-ok-soft px-4 py-3 text-sm font-semibold text-ok">Decision changed because of memory</div>
      ) : (
        <div role="status" className="rounded-xl border border-line bg-panel-2 px-4 py-3">
          <div className="text-sm font-semibold">No change: memory did not alter the decision</div>
          <p className="mt-0.5 text-xs text-muted">With and without memory, the verdict and constraints are the same for this question. That is a valid result: memory only matters where a governed decision applies.</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Arm title="Without memory" sub="No memory in the prompt" answer={c.without_memory} />
        <Arm title="With governed memory" sub={`${c.memories_used.length} ${c.memories_used.length === 1 ? "memory" : "memories"} in the prompt`} answer={c.with_memory} highlight={c.changed === true} />
      </div>

      <Card>
        <CardHeader title="What differs" sub="Fields whose value changed between the two arms" />
        <div className="p-4 text-xs">
          {c.diff.length === 0 ? <p className="text-muted">Nothing differs.</p> : (
            <ul className="space-y-2">
              {c.diff.map((d, i) => (
                <li key={`${d.field}-${i}`} className="rounded-lg border border-line bg-panel-2 p-2.5">
                  <div className="mb-1 font-mono text-[11px] text-brand">{d.field}</div>
                  <div className="flex flex-wrap items-start gap-2"><span className="min-w-0 flex-1 break-words text-muted line-through decoration-bad/60">{d.without || "(empty)"}</span><ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" /><span className="min-w-0 flex-1 break-words text-fg">{d.with || "(empty)"}</span></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Memories used" sub="Governed memories the with-memory arm was given" />
        <div className="space-y-1.5 p-4 text-xs">
          {c.memories_used.length === 0 ? <p className="text-muted">No memory was eligible for this question, so both arms had identical context.</p> : c.memories_used.map((m) => (
            <button key={`${m.memory_id}@${m.version}`} onClick={() => openMemory(m.memory_id)} className="flex w-full items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-left hover:border-brand">
              <span className="min-w-0 flex-1 truncate">{m.title}</span><Badge tone="ok" className="font-mono">{m.memory_id}@v{m.version}</Badge>
            </button>
          ))}
          {c.evidence_run_id && <p className="pt-1 text-muted">Shared evidence run: <button onClick={() => openRun(c.evidence_run_id!)} className="font-mono text-brand hover:underline">{c.evidence_run_id}</button></p>}
        </div>
      </Card>
    </div>
  );
}

function Arm({ title, sub, answer, highlight }: { title: string; sub: string; answer: Answer | null; highlight?: boolean }) {
  return (
    <Card className={cn(highlight && "border-ok/40")}>
      <CardHeader title={title} sub={sub} />
      <div className="space-y-3 p-4">
        {!answer ? <p className="text-xs text-muted">No answer was produced for this arm.</p> : (
          <>
            <div className="flex flex-wrap items-center gap-2"><VerdictBadge verdict={answer.guidance.verdict} /><Badge>confidence: {answer.confidence}</Badge></div>
            <div className="text-[13px] font-semibold">{answer.headline}</div>
            <GuidanceBlock guidance={answer.guidance} />
            <div><Label>Verdict value</Label><code className="font-mono text-[11px] text-muted">{answer.guidance.verdict}</code></div>
          </>
        )}
      </div>
    </Card>
  );
}
