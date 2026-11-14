"use client";
import { BookOpen, Brain, Check, ChevronDown, ChevronRight, Clock, GitBranch, Loader2, Minus, Ticket, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FindingChip, FindingRow } from "@/components/findings";
import { Badge, cn } from "@/components/ui";
import type { AgentId, AgentStatus, Run } from "@/lib/types";

export const AGENT_META: Record<AgentId, { icon: typeof GitBranch; tone: string }> = {
  github: { icon: GitBranch, tone: "text-fg" },
  jira: { icon: Ticket, tone: "text-info" },
  confluence: { icon: BookOpen, tone: "text-brand" },
  memory: { icon: Brain, tone: "text-ok" },
};

export interface FocusRef { ref: string; nonce: number }

function StatusMark({ status }: { status: AgentStatus["status"] }) {
  switch (status) {
    case "pending": return <><Clock className="h-3 w-3" />waiting</>;
    case "running": return <><Loader2 className="h-3 w-3 animate-spin text-brand" />running</>;
    case "done": return <><Check className="h-3 w-3 text-ok" />done</>;
    case "skipped": return <><Minus className="h-3 w-3" />skipped</>;
    case "error": return <><X className="h-3 w-3 text-bad" />error</>;
  }
}

export function AgentCard({ agent, focus, expandAll }: { agent: AgentStatus; focus?: FocusRef | null; expandAll?: boolean }) {
  const [open, setOpen] = useState(!!expandAll);
  const box = useRef<HTMLDivElement>(null);
  const Icon = AGENT_META[agent.id].icon;
  const focusRef = focus && agent.findings.some((f) => f.ref === focus.ref) ? focus.ref : null;
  const canOpen = agent.findings.length > 0;

  useEffect(() => {
    if (!focusRef) return;
    setOpen(true);
    const t = setTimeout(() => {
      const rows = box.current?.querySelectorAll<HTMLElement>("[data-finding-ref]");
      Array.from(rows ?? []).find((r) => r.dataset.findingRef === focusRef)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  const skipped = agent.status === "skipped";
  return (
    <div ref={box} className={cn("rounded-md border px-2.5 py-2 text-[12px]", skipped ? "border-dashed border-line opacity-80" : agent.status === "error" ? "border-bad/40 bg-bad-soft" : "border-line bg-bg/40", agent.status === "pending" && "opacity-60")}>
      <button className="flex w-full items-center gap-2 text-left" disabled={!canOpen} onClick={() => setOpen((o) => !o)} aria-expanded={canOpen ? open : undefined}>
        <Icon className={cn("h-3.5 w-3.5", AGENT_META[agent.id].tone)} />
        <span className="font-medium">{agent.label}</span>
        <span className="ml-auto flex items-center gap-1.5 text-muted">
          <StatusMark status={agent.status} />
          {canOpen && (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
        </span>
      </button>

      {agent.tools.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-l border-line pl-2 font-mono text-[11.5px] text-muted">
          {agent.tools.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5" title={t.text}>
              {t.status === "running" ? <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-brand" /> : t.status === "error" ? <X className="h-2.5 w-2.5 shrink-0 text-bad" /> : <Check className="h-2.5 w-2.5 shrink-0 text-ok" />}
              <span className="truncate">{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {agent.error && <div className="mt-1.5 break-words text-bad">{agent.error}</div>}
      {(agent.status === "done" || skipped) && agent.summary && <div className="mt-1.5 text-muted">{agent.summary}</div>}

      {canOpen && !open && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {agent.findings.map((f) => <FindingChip key={f.ref} f={f} onClick={() => setOpen(true)} />)}
        </div>
      )}
      {canOpen && open && (
        <div className="mt-2 space-y-1 border-t border-line pt-2">
          {agent.findings.map((f) => <FindingRow key={f.ref} f={f} focused={focusRef === f.ref} />)}
        </div>
      )}
    </div>
  );
}

/** Orchestrator, the four sub-agent cards and the reasoning step, straight from the Run object. */
export function RunProgress({ run, focus, expandAll }: { run: Run; focus?: FocusRef | null; expandAll?: boolean }) {
  const planning = run.orchestrator.status === "planning";
  const r = run.reasoning;
  return (
    <div className="rounded-lg border border-line bg-panel/70 p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        {planning && run.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> : <Check className="h-3.5 w-3.5 text-ok" />}
        <span className="font-medium">Orchestrator</span>
        <span className="text-muted">{planning ? (run.status === "running" ? "planning which sources to search…" : "stopped before a plan was made") : `plan: ${run.orchestrator.plan.length} sub-agent${run.orchestrator.plan.length === 1 ? "" : "s"}`}</span>
        {run.orchestrator.plan.map((p) => <Badge key={p} className="font-mono">{p}</Badge>)}
      </div>
      {run.orchestrator.note && <p className="mt-1 pl-5 text-[12px] text-muted">{run.orchestrator.note}</p>}

      <div className="mt-2 space-y-1.5">
        {run.agents.map((a) => <AgentCard key={a.id} agent={a} focus={focus} expandAll={expandAll} />)}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
        {r.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> : r.status === "done" ? <Check className="h-3.5 w-3.5 text-ok" /> : r.status === "error" ? <X className="h-3.5 w-3.5 text-bad" /> : <Clock className="h-3.5 w-3.5 text-muted" />}
        <span className="font-medium">Reasoning agent</span>
        <span className="text-muted">
          {r.status === "pending" && "waiting for evidence"}
          {r.status === "running" && `combining evidence${run.memory_enabled ? " and memory" : ""}…`}
          {r.status === "done" && "answer ready"}
          {r.status === "error" && "reasoning failed"}
        </span>
        {r.model && <Badge className="ml-auto font-mono">{r.model}</Badge>}
      </div>
    </div>
  );
}
