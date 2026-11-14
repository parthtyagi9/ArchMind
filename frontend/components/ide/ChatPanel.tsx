"use client";
import { Brain, Link2, Send, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppState";
import { SubmitState, ThreadEntry, type ThreadItem } from "@/components/ide/ThreadEntry";
import { Button, ErrorBanner, InfoBanner, Skeleton, cn } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { selLabel } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { Run, Selection } from "@/lib/types";

let keySeq = 0;
const nextKey = () => `q${Date.now()}_${++keySeq}`;
const fromRun = (r: Run): ThreadItem => ({ key: r.id, question: r.question, selection: r.selection, runId: r.id, run: r, submitError: null });

export function ChatPanel() {
  const { workspace, repo, memoryOn, setMemoryOn, pendingSelection, setPendingSelection, askRequest, can, me, openPage, integrations, refreshIntegrations } = useApp();
  const repoId = workspace?.kind === "repo" ? workspace.repoId : null;
  const isLocal = workspace?.kind === "local";
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const canAsk = can("ask");
  const sources = integrations?.public_sources.filter((s) => !s.repo_id || s.repo_id === repoId) ?? [];
  const sourceConnected = (kind: "jira" | "confluence") => sources.some((s) => s.kind === kind)
    || !!(integrations?.atlassian.connected && integrations.atlassian[`${kind}_available`]);

  useEffect(() => {
    void refreshIntegrations();
    const refresh = () => void refreshIntegrations();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refreshIntegrations]);

  // Prior runs for this repository, so the thread persists across reloads.
  const history = useAsync(() => api.runs({ repo_id: repoId ?? undefined, limit: 30 }), [repoId], repoId !== null);
  useEffect(() => {
    const runs = history.data;
    if (!runs) return;
    setItems((cur) => {
      const have = new Set(cur.map((i) => i.runId));
      return [...runs.slice().reverse().filter((r) => !have.has(r.id)).map(fromRun), ...cur];
    });
  }, [history.data]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [items.length, history.data]);

  const patch = useCallback((key: string, p: Partial<ThreadItem>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))), []);

  const start = useCallback(async (key: string, question: string, selection: Selection | null) => {
    try {
      const { run_id } = await api.startRun({
        kind: selection ? "why" : "ask", question, memory_enabled: memoryOn,
        ...(repoId ? { repo_id: repoId } : {}), ...(selection ? { selection } : {}),
      });
      patch(key, { runId: run_id, submitError: null });
    } catch (e) { patch(key, { submitError: errorMessage(e) }); }
  }, [memoryOn, repoId, patch]);

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
        <button onClick={() => setMemoryOn(!memoryOn)} aria-pressed={memoryOn} className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px]"
          title="When off, runs are made without any organizational memory (memory_enabled: false)">
          <Brain className={cn("h-3 w-3", memoryOn ? "text-ok" : "text-muted")} />
          <span className={memoryOn ? "text-ok" : "text-muted"}>Governed memory {memoryOn ? "on" : "off"}</span>
        </button>
      </div>

      {integrations && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1.5 text-[11px]" aria-label="Sources for this workspace">
        {(["jira", "confluence"] as const).map((kind) => <button key={kind} onClick={() => openPage("settings")}
          title="Manage sources for this workspace in Settings → Integrations" className={sourceConnected(kind) ? "text-ok hover:underline" : "text-muted hover:text-brand hover:underline"}>
          {kind === "jira" ? "Jira" : "Confluence"} {sourceConnected(kind) ? "connected" : "not connected"}
        </button>)}
        {can("manage_integrations") && (!sourceConnected("jira") || !sourceConnected("confluence")) && <button onClick={() => openPage("settings")} className="ml-auto text-brand hover:underline">Connect</button>}
      </div>}

      {isLocal && <InfoBanner tone="info" className="m-3 mb-0">Local files: GitHub provenance unavailable. The GitHub agent will report itself skipped; Jira, Confluence and Memory still run.</InfoBanner>}
      {repo && repo.status !== "ready" && <InfoBanner className="m-3 mb-0">This repository is {repo.status === "indexing" ? "still indexing" : "not indexed"}. Answers will have less evidence until indexing finishes.</InfoBanner>}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {history.loading && !history.data && <div className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-24" /></div>}
        {history.error != null && <ErrorBanner error={history.error} onRetry={history.reload} />}

        {items.length === 0 && !history.loading && (
          <div className="space-y-3 pt-6 text-center text-xs text-muted">
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-brand-soft"><Sparkles className="h-5 w-5 text-brand" /></div>
            <p className="text-sm text-fg">Ask why anything exists</p>
            <p className="leading-relaxed">Select code in the editor and choose <span className="text-brand">Why does this exist?</span>. ArchMind deploys GitHub, Jira, Confluence and Memory sub-agents, then answers with cited evidence and a guidance verdict.</p>
            <p className="leading-relaxed">You can also type a question about the architecture below.</p>
            {can("manage_integrations") && <button onClick={() => openPage("settings")} className="inline-flex items-center gap-1.5 text-brand hover:underline"><Link2 className="h-3.5 w-3.5" />Connect Jira or Confluence context</button>}
          </div>
        )}

        {items.map((item) => (item.runId ? <ThreadEntry key={item.key} item={{ ...item, runId: item.runId }} /> : <SubmitState key={item.key} item={item} onRetry={() => retry(item)} />))}
        <div ref={bottom} />
      </div>

      <div className="border-t border-line p-3">
        {pendingSelection && (
          <div className="mb-2 rounded-lg border border-brand/30 bg-brand-soft p-2 text-[11px]">
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
        <div className="mt-1.5 text-[10px] text-muted">as {me.user.name} · {me.org.name}{me.org.team ? ` · team ${me.org.team}` : ""} · memory {memoryOn ? "on" : "off"}</div>
      </div>
    </div>
  );
}
