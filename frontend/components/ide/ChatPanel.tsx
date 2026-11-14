"use client";
import { BookOpen, Brain, Check, ChevronDown, ChevronRight, GitBranch, Loader2, Minus, Network, Send, Sparkles, Ticket, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, cn } from "@/components/ui";
import { SCENARIOS } from "@/lib/mock";
import type { AgentId, AgentSpec, Memory, ThreadItem } from "@/lib/types";

const PLAN_MS = 600;
const REASON_MS = 1100;

const AGENT_META: Record<AgentId, { icon: typeof GitBranch; tone: string }> = {
  github: { icon: GitBranch, tone: "text-fg" },
  jira: { icon: Ticket, tone: "text-info" },
  confluence: { icon: BookOpen, tone: "text-brand" },
  memory: { icon: Brain, tone: "text-ok" },
};

export function ChatPanel() {
  const { thread, ask, user, memoryOn, setMemoryOn, pendingSelection, setPendingSelection, workspace } = useApp();
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread.length]);

  const submit = (q?: string) => {
    const question = (q ?? text).trim() || (pendingSelection ? "Why does this exist?" : "");
    if (!question) return;
    setNote(ask(question, pendingSelection));
    setText("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Sparkles className="h-4 w-4 text-brand" />
        <span className="text-xs font-semibold">ArchMind</span>
        <button onClick={() => setMemoryOn(!memoryOn)} className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px]" title="When off, the memory agent is not deployed">
          <Brain className={cn("h-3 w-3", memoryOn ? "text-ok" : "text-muted")} />
          <span className={memoryOn ? "text-ok" : "text-muted"}>Governed memory {memoryOn ? "on" : "off"}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {thread.length === 0 && (
          <div className="space-y-3 pt-6 text-center text-xs text-muted">
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-brand-soft"><Sparkles className="h-5 w-5 text-brand" /></div>
            <p className="text-sm text-fg">Ask why anything exists</p>
            <p className="leading-relaxed">Select code in the editor and choose <span className="text-brand">Why does this exist?</span>. ArchMind deploys GitHub, Jira, Confluence and Memory sub-agents, then explains it with sources.</p>
            {workspace?.demo && (
              <div className="space-y-1.5 pt-2 text-left">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted/70">Or ask an architecture question</div>
                {SCENARIOS.map((s) => (
                  <button key={s.id} onClick={() => submit(s.question)} className="block w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-left text-xs text-fg hover:border-brand">{s.question}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {thread.map((item) => <ThreadEntry key={item.id} item={item} />)}
        <div ref={bottom} />
      </div>

      <div className="border-t border-line p-3">
        {pendingSelection && (
          <div className="mb-2 rounded-lg border border-brand/30 bg-brand-soft p-2 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="font-mono text-brand">{pendingSelection.path.split("/").pop()}:{pendingSelection.startLine}{pendingSelection.endLine !== pendingSelection.startLine ? `–${pendingSelection.endLine}` : ""}</span>
              <button className="ml-auto text-muted hover:text-fg" onClick={() => setPendingSelection(null)}><X className="h-3 w-3" /></button>
            </div>
            <pre className="mt-1 max-h-16 overflow-hidden font-mono text-muted">{pendingSelection.text.slice(0, 240)}</pre>
          </div>
        )}
        {note && <p className="mb-2 text-[11px] text-warn">{note}</p>}
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={pendingSelection ? "Ask about the selection…" : "Ask about the architecture…"}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-xs outline-none placeholder:text-muted/70 focus:border-brand" />
          <Button type="submit" size="sm" className="h-9"><Send className="h-3.5 w-3.5" /></Button>
        </form>
        <div className="mt-1.5 text-[10px] text-muted">as {user.name} · tenant {user.tenant} · answers use synthetic demo evidence</div>
      </div>
    </div>
  );
}

function useElapsed(startedAt: number, total: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Date.now() - startedAt >= total) return;
    const t = setInterval(() => { setNow(Date.now()); if (Date.now() - startedAt >= total) clearInterval(t); }, 120);
    return () => clearInterval(t);
  }, [startedAt, total]);
  return Math.max(0, now - startedAt);
}

function ThreadEntry({ item }: { item: ThreadItem }) {
  const longest = Math.max(0, ...item.agents.map((a) => a.durationMs));
  const allEnd = PLAN_MS + longest;
  const total = allEnd + REASON_MS;
  const elapsed = useElapsed(item.startedAt, total);
  const done = elapsed >= total;
  const reasoning = elapsed >= allEnd && !done;
  const planned = elapsed >= PLAN_MS;
  const active = item.agents.filter((a) => !a.skipped);

  return (
    <div className="space-y-2.5">
      <div className="ml-6 rounded-lg rounded-tr-sm bg-brand-soft px-3 py-2 text-xs">
        {item.selection && (
          <div className="mb-1.5 rounded-md border border-line bg-bg/60 p-1.5">
            <div className="font-mono text-[10px] text-brand">{item.selection.path}:{item.selection.startLine}{item.selection.endLine !== item.selection.startLine ? `–${item.selection.endLine}` : ""}</div>
            <pre className="mt-0.5 max-h-14 overflow-hidden font-mono text-[10.5px] text-muted">{item.selection.text.slice(0, 200)}</pre>
          </div>
        )}
        {item.question}
      </div>

      <div className="rounded-lg border border-line bg-panel/70 p-2.5">
        <div className="flex items-center gap-2 text-[11px]">
          {planned ? <Check className="h-3.5 w-3.5 text-ok" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />}
          <span className="font-medium">Orchestrator</span>
          <span className="text-muted">{planned ? `deployed ${active.length} sub-agent${active.length === 1 ? "" : "s"} in parallel` : "planning which sources to search…"}</span>
        </div>

        {planned && (
          <div className="mt-2 space-y-1.5">
            {item.agents.map((a) => <AgentCard key={a.id} agent={a} elapsed={elapsed - PLAN_MS} />)}
          </div>
        )}

        {elapsed >= allEnd && (
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            {reasoning ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> : <Check className="h-3.5 w-3.5 text-ok" />}
            <span className="font-medium">Reasoning agent</span>
            <span className="text-muted">{reasoning ? "combining evidence and memory…" : "answer ready"}</span>
          </div>
        )}
      </div>

      {done && <FinalCard item={item} />}
    </div>
  );
}

function AgentCard({ agent, elapsed }: { agent: AgentSpec; elapsed: number }) {
  const [open, setOpen] = useState(false);
  const meta = AGENT_META[agent.id];
  const Icon = meta.icon;
  const finished = agent.skipped || elapsed >= agent.durationMs;
  const n = agent.tools.length;
  const visibleTools = agent.tools.filter((_, i) => finished || elapsed >= ((i + 1) / (n + 1)) * agent.durationMs);

  return (
    <div className={cn("rounded-md border px-2.5 py-2 text-[11px]", agent.skipped ? "border-dashed border-line opacity-60" : "border-line bg-bg/40")}>
      <button className="flex w-full items-center gap-2 text-left" onClick={() => finished && !agent.skipped && agent.findings.length > 0 && setOpen((o) => !o)}>
        <Icon className={cn("h-3.5 w-3.5", meta.tone)} />
        <span className="font-medium">{agent.label}</span>
        <span className="ml-auto flex items-center gap-1.5 text-muted">
          {agent.skipped ? <><Minus className="h-3 w-3" />skipped</> : finished ? <><Check className="h-3 w-3 text-ok" />done</> : <><Loader2 className="h-3 w-3 animate-spin text-brand" />running</>}
          {finished && !agent.skipped && agent.findings.length > 0 && (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
        </span>
      </button>

      {visibleTools.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-l border-line pl-2 font-mono text-[10.5px] text-muted">
          {visibleTools.map((t) => <div key={t} className="truncate" title={t}>{t}</div>)}
        </div>
      )}

      {finished && <div className="mt-1.5 text-muted">{agent.summary}</div>}

      {finished && agent.findings.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {agent.findings.map((f) => <Badge key={f.ref} tone={agent.id === "memory" ? "ok" : "brand"} className="font-mono">{f.ref}</Badge>)}
        </div>
      )}

      {open && (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2">
          {agent.findings.map((f) => (
            <div key={f.ref}>
              <div className="flex gap-2"><span className="font-mono text-brand">{f.ref}</span><span className="text-fg">{f.title}</span></div>
              {f.detail && <div className="mt-0.5 whitespace-pre-wrap text-muted">{f.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FinalCard({ item }: { item: ThreadItem }) {
  const { setHighlight, openPage, setFocusMemoryId, user, addMemory, log } = useApp();
  const f = item.final;

  const showGraph = () => { setHighlight(f.affected); openPage("explorer"); };
  const propose = () => {
    const m: Memory = {
      id: `m_prop_${Date.now()}`, title: f.headline, type: "architecture_decision", status: "pending", version: 1, content: f.advice,
      tenant: user.tenant, scope: "team", team: user.team, repo: "payments-platform", authority: "agent_observed",
      sources: [{ type: "agent_run", id: item.runId, label: `Agent run ${item.runId}` }], expiresAt: null, components: f.affected, usedInRuns: 0,
      history: [{ version: 1, content: f.advice, status: "pending", by: "ArchMind agent", at: "now", note: `Proposed from ${item.runId}` }],
    };
    addMemory(m);
    log({ type: "memory.created", actor: "ArchMind agent", memoryId: m.id, detail: `Proposed from ${item.runId} (pending approval)` });
    openPage("approvals");
  };

  return (
    <div className="rounded-lg border border-line bg-panel p-3 text-[12.5px] leading-relaxed">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={f.memoryRefs.length ? "ok" : "neutral"}>{f.memoryRefs.length ? "memory-informed" : "no memory applied"}</Badge>
        <Badge tone="brand" className="font-mono">{f.decision}</Badge>
        <span className="ml-auto font-mono text-[10px] text-muted">{item.runId}</span>
      </div>
      <div className="mb-1.5 text-sm font-semibold">{f.headline}</div>
      {f.paragraphs.map((p, i) => <p key={i} className="mb-2 text-fg/90">{p}</p>)}

      <div className={cn("rounded-md border p-2.5 text-xs", f.caution ? "border-warn/30 bg-warn-soft" : "border-line bg-panel-2")}>
        <div className={cn("mb-0.5 text-[10px] font-medium uppercase tracking-wider", f.caution ? "text-warn" : "text-muted")}>Before you change it</div>
        {f.advice}
      </div>

      {f.constraints.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">Constraints from approved memory</div>
          <ul className="space-y-1 text-xs">{f.constraints.map((c) => <li key={c} className="flex gap-1.5"><Brain className="mt-0.5 h-3 w-3 shrink-0 text-ok" />{c}</li>)}</ul>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {f.memoryRefs.map((m) => <button key={m.id} onClick={() => { setFocusMemoryId(m.id); openPage("memory"); }}><Badge tone="ok">◆ {m.title} · v{m.version}</Badge></button>)}
          </div>
        </div>
      )}

      {f.risks.length > 0 && <ul className="mt-2.5 list-disc space-y-0.5 pl-4 text-xs text-muted">{f.risks.map((r) => <li key={r}>{r}</li>)}</ul>}

      {f.evidence.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">Evidence</div>
          <div className="flex flex-wrap gap-1">{f.evidence.map((e) => <Badge key={e} className="font-mono">{e}</Badge>)}</div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-2.5">
        {f.affected.length > 0 && <Button size="sm" variant="outline" onClick={showGraph}><Network className="h-3.5 w-3.5" />Show in architecture</Button>}
        {f.memoryRefs.length > 0 && <Button size="sm" variant="outline" onClick={propose}>Propose as decision</Button>}
      </div>
    </div>
  );
}
