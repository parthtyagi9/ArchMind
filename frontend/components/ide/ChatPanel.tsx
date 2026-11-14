"use client";
import { Brain, Code2, PanelRightClose, Send, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppState";
import { SubmitState, ThreadEntry, type ThreadItem } from "@/components/ide/ThreadEntry";
import { Button, ErrorBanner, InfoBanner, Skeleton, cn } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { selLabel } from "@/lib/format";
import { apiSelection, groupPath } from "@/lib/groupData";
import { useAsync } from "@/lib/hooks";
import type { Run, Selection } from "@/lib/types";

let keySeq = 0;
const nextKey = () => `q${Date.now()}_${++keySeq}`;
const fromRun = (r: Run): ThreadItem => ({ key: r.id, question: r.question, selection: r.selection, runId: r.id, run: r, submitError: null });

export function ChatPanel() {
  const { setChatOpen, workspace, repo, group, groupMembers, memoryOn, setMemoryOn, pendingSelection, setPendingSelection, askRequest, can, me, openPage } = useApp();
  const repoId = workspace?.kind === "repo" ? workspace.repoId : null;
  const groupId = workspace?.kind === "group" ? workspace.groupId : null;
  const isLocal = workspace?.kind === "local";
  const membersRef = useRef(groupMembers);
  membersRef.current = groupMembers;
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const canAsk = can("ask");

  // Prior runs for this repository (or group), so the thread persists across reloads.
  const history = useAsync(() => api.runs(groupId ? { group_id: groupId, limit: 30 } : { repo_id: repoId ?? undefined, limit: 30 }), [repoId, groupId], repoId !== null || groupId !== null);
  useEffect(() => {
    const runs = history.data;
    if (!runs) return;
    setItems((cur) => {
      const have = new Set(cur.map((i) => i.runId));
      // in a group, show the selection with its repository prefix, the way it appears in the explorer
      const shown = runs.map((r) => (r.group_id && r.selection && r.repo_name ? { ...r, selection: { ...r.selection, path: groupPath(r.repo_name, r.selection.path) } } : r));
      return [...shown.slice().reverse().filter((r) => !have.has(r.id)).map(fromRun), ...cur];
    });
  }, [history.data]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [items.length, history.data]);

  const patch = useCallback((key: string, p: Partial<ThreadItem>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))), []);

  const start = useCallback(async (key: string, question: string, selection: Selection | null) => {
    try {
      const sel = selection && groupId ? apiSelection(membersRef.current, selection) : selection;
      const { run_id } = await api.startRun({
        kind: selection ? "why" : "ask", question, memory_enabled: memoryOn,
        ...(groupId ? { group_id: groupId } : repoId ? { repo_id: repoId } : {}), ...(sel ? { selection: sel } : {}),
      });
      patch(key, { runId: run_id, submitError: null });
    } catch (e) { patch(key, { submitError: errorMessage(e) }); }
  }, [memoryOn, repoId, groupId, patch]);

  const submit = useCallback((question: string, selection: Selection | null) => {
    const key = nextKey();
    setItems((cur) => [...cur, { key, question, selection, runId: null, run: null, submitError: null }]);
    void start(key, question, selection);
  }, [start]);

  const retry = (item: ThreadItem) => { patch(item.key, { submitError: null }); void start(item.key, item.question, item.selection); };

  // Questions raised from the editor ("Why does this exist?"). Requests made before this panel mounted are ignored.
  const handled = useRef(askRequest?.nonce ?? 0);
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!askRequest || askRequest.nonce === handled.current) return;
    handled.current = askRequest.nonce;
    submitRef.current(askRequest.question, askRequest.selection);
  }, [askRequest]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const question = text.trim() || (pendingSelection ? "Why does this exist?" : "");
    if (!question || !canAsk) return;
    submit(question, pendingSelection);
    setPendingSelection(null);
    setText("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Sparkles className="h-4 w-4 text-brand" />
        <span className="text-xs font-semibold">ArchMind</span>
        <button onClick={() => setMemoryOn(!memoryOn)} aria-pressed={memoryOn} className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px]"
          title="When off, runs are made without any organizational memory (memory_enabled: false)">
          <Brain className={cn("h-3 w-3", memoryOn ? "text-ok" : "text-muted")} />
          <span className={memoryOn ? "text-ok" : "text-muted"}>Governed memory {memoryOn ? "on" : "off"}</span>
        </button>
        <button onClick={() => setChatOpen(false)} aria-label="Collapse assistant" title="Collapse the assistant panel"
          className="rounded-md p-1 text-muted hover:bg-line/50 hover:text-fg"><PanelRightClose className="h-4 w-4" /></button>
      </div>
      <div className={cn("border-b border-line px-3 py-1.5 text-[12px] leading-snug", memoryOn ? "text-muted" : "bg-warn-soft/40 text-warn")}>
        {memoryOn
          ? <>Answers use <span className="text-fg">approved</span> organizational memories you are allowed to see. <button className="text-brand hover:underline" onClick={() => openPage("governance")}>How?</button></>
          : <>Memory is off: answers ignore every organizational decision and rule. Use this to see the agent's unconstrained answer.</>}
      </div>

      {isLocal && <InfoBanner tone="info" className="m-3 mb-0">Local files: GitHub provenance unavailable. The GitHub agent will report itself skipped; Jira, Confluence and Memory still run.</InfoBanner>}
      {group && groupMembers.some((r) => r.status !== "ready") && <InfoBanner className="m-3 mb-0">Some repositories in this group are not indexed yet. Answers search only the indexed ones.</InfoBanner>}
      {repo && repo.status !== "ready" && <InfoBanner className="m-3 mb-0">This repository is {repo.status === "indexing" ? "still indexing" : "not indexed"}. Answers will have less evidence until indexing finishes.</InfoBanner>}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {history.loading && !history.data && <div className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-24" /></div>}
        {history.error != null && <ErrorBanner error={history.error} onRetry={history.reload} />}

        {items.length === 0 && !history.loading && (
          <div className="space-y-4 pt-4 text-xs text-muted">
            <div className="text-center">
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-brand-soft"><Sparkles className="h-5 w-5 text-brand" /></div>
              <p className="mt-2 text-sm text-fg">Ask why anything exists</p>
              <p className="mt-1 leading-relaxed">Every answer cites the code, history, tickets and approved team knowledge it used.</p>
            </div>
            <p className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[13px] leading-relaxed">
              <Code2 className="mr-1 inline h-4 w-4 text-brand" />Select code and click <span className="text-brand">Why does this exist?</span>, or ask anything below.
            </p>
            {canAsk && (
              <div>
                <div className="mb-1.5 text-[11px] font-medium ">Try asking</div>
                <div className="space-y-1.5">
                  {STARTERS.map((q) => (
                    <button key={q} onClick={() => submit(q, null)}
                      className="block w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-left text-[13px] text-fg/90 transition-colors hover:border-brand hover:text-fg">{q}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {items.map((item) => (item.runId ? <ThreadEntry key={item.key} item={{ ...item, runId: item.runId }} /> : <SubmitState key={item.key} item={item} onRetry={() => retry(item)} />))}
        <div ref={bottom} />
      </div>

      <div className="border-t border-line p-3">
        {pendingSelection && (
          <div className="mb-2 rounded-lg border border-brand/30 bg-brand-soft p-2 text-[12px]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-brand">{selLabel(pendingSelection)}</span>
              <button className="ml-auto text-muted hover:text-fg" aria-label="Remove selection" onClick={() => setPendingSelection(null)}><X className="h-3 w-3" /></button>
            </div>
            <pre className="mt-1 max-h-16 overflow-hidden font-mono text-muted">{pendingSelection.text.slice(0, 240)}</pre>
          </div>
        )}
        <form onSubmit={onSubmit} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} disabled={!canAsk} aria-label="Question"
            placeholder={!canAsk ? "Your role cannot ask questions" : pendingSelection ? "Ask about the selection…" : "Ask about the architecture…"}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-xs outline-none placeholder:text-muted/70 focus:border-brand disabled:opacity-60" />
          <Button type="submit" size="sm" className="h-9" disabled={!canAsk || (!text.trim() && !pendingSelection)} aria-label="Send"><Send className="h-3.5 w-3.5" /></Button>
        </form>
        <div className="mt-1.5 text-[11px] text-muted">as {me.user.name} · {me.org.name}{me.org.team ? ` · team ${me.org.team}` : ""} · memory {memoryOn ? "on" : "off"}</div>
      </div>
    </div>
  );
}

const STARTERS = [
  "What are the main components of this codebase and how do they depend on each other?",
  "Which approved decisions or rules should I know before changing this repository?",
  "Is it safe to change the default configuration values in this project? What could break?",
];
