"use client";
import { AlertTriangle, Loader2, Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppState";
import { AnswerCard } from "@/components/ide/AnswerCard";
import { RunProgress, type FocusRef } from "@/components/ide/AgentCard";
import { Button, ErrorBanner, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { usePolling } from "@/lib/hooks";
import type { Run, Selection } from "@/lib/types";

export interface ThreadItem {
  key: string;
  question: string;
  selection: Selection | null;
  runId: string | null;
  run: Run | null;
  submitError: string | null;
}

function QuestionBubble({ question, selection }: { question: string; selection: Selection | null }) {
  return (
    <div className="ml-6 rounded-lg rounded-tr-sm bg-brand-soft px-3 py-2 text-xs">
      {selection && (
        <div className="mb-1.5 rounded-md border border-line bg-bg/60 p-1.5">
          <div className="font-mono text-[10px] text-brand">{selection.path}:{selection.start_line}{selection.end_line !== selection.start_line ? `–${selection.end_line}` : ""}</div>
          <pre className="mt-0.5 max-h-14 overflow-hidden font-mono text-[10.5px] text-muted">{selection.text.slice(0, 200)}</pre>
        </div>
      )}
      {question}
    </div>
  );
}

export function SubmitState({ item, onRetry }: { item: ThreadItem; onRetry: () => void }) {
  return (
    <div className="space-y-2.5">
      <QuestionBubble question={item.question} selection={item.selection} />
      {item.submitError
        ? <ErrorBanner error={item.submitError} onRetry={onRetry} />
        : <div className="flex items-center gap-2 text-[11px] text-muted" role="status"><Spinner className="h-3.5 w-3.5" />Starting agents…</div>}
    </div>
  );
}

export function ThreadEntry({ item }: { item: ThreadItem & { runId: string } }) {
  const { openPage, setHighlight, repo, can } = useApp();
  const poll = usePolling<Run>({
    id: item.runId, initial: item.run, fetch: () => api.run(item.runId),
    keepGoing: (r) => r.status === "running", intervalMs: 600,
  });
  const run = poll.data;
  const [focus, setFocus] = useState<FocusRef | null>(null);
  const [proposedId, setProposedId] = useState<string | null>(item.run?.proposed_memory_id ?? null);
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const sawRunning = useRef(item.run?.status === "running");

  useEffect(() => {
    if (!run) return;
    if (run.status === "running") sawRunning.current = true;
    else if (sawRunning.current && run.status === "completed" && run.answer) {
      sawRunning.current = false;
      setHighlight(run.answer.affected_components);
    }
  }, [run, setHighlight]);

  useEffect(() => { if (run?.proposed_memory_id) setProposedId(run.proposed_memory_id); }, [run?.proposed_memory_id]);

  const propose = async () => {
    setProposing(true); setProposeError(null);
    try {
      const m = await api.proposeMemory(item.runId);
      setProposedId(m.memory_id);
      openPage("approvals");
    } catch (e) { setProposeError(errorMessage(e)); }
    finally { setProposing(false); }
  };

  const question = run?.question ?? item.question;
  const selection = run?.selection ?? item.selection;

  return (
    <div className="space-y-2.5">
      <QuestionBubble question={question} selection={selection} />
      {!run && poll.error == null && <div className="flex items-center gap-2 text-[11px] text-muted" role="status"><Spinner className="h-3.5 w-3.5" />Loading run…</div>}
      {poll.error != null && <ErrorBanner error={poll.error} onRetry={poll.retry} />}
      {run && (
        <>
          <RunProgress run={run} focus={focus} />
          {run.status === "running" && <div className="flex items-center gap-2 text-[11px] text-muted" role="status"><Loader2 className="h-3 w-3 animate-spin text-brand" />Working… progress updates live.</div>}
          {run.status === "failed" && (
            <div role="alert" className="flex gap-2 rounded-lg border border-bad/30 bg-bad-soft p-2.5 text-xs text-bad">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div><div className="font-medium">This run failed</div><div className="mt-0.5 break-words">{run.error ?? "The backend reported a failure without details."}</div></div>
            </div>
          )}
          {run.status === "completed" && run.answer && (
            <AnswerCard
              answer={run.answer} runId={run.id} memoryEnabled={run.memory_enabled}
              memoriesUsed={run.memory.retrieved.filter((r) => r.used).length}
              canShowGraph={!!run.repo_id && repo?.id === run.repo_id}
              onEvidence={(ref) => setFocus((f) => ({ ref, nonce: (f?.nonce ?? 0) + 1 }))}
              footer={
                <>
                  {proposedId ? (
                    <Button size="sm" variant="outline" onClick={() => openPage("approvals")}><Lightbulb className="h-3.5 w-3.5" />Proposed · open Approvals</Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!can("propose_memory") || proposing} onClick={() => void propose()}
                      title={can("propose_memory") ? "Create a pending memory from this answer" : "Requires the propose_memory permission"}>
                      {proposing ? <Spinner className="h-3 w-3" /> : <Lightbulb className="h-3.5 w-3.5" />}Propose as memory
                    </Button>
                  )}
                </>
              }
            />
          )}
          {run.status === "completed" && !run.answer && <ErrorBanner error="The run completed without an answer. Open it in the Run Inspector for details." />}
          {proposeError && <ErrorBanner error={proposeError} />}
        </>
      )}
    </div>
  );
}
