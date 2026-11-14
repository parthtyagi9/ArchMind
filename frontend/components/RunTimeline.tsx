"use client";
import { useState } from "react";
import {
  Brain, ChevronDown, ChevronRight, Database, Hand, Search, ShieldAlert, ShieldCheck, Sparkles, Wrench,
} from "lucide-react";
import type { Step } from "@/lib/api";
import { Badge, Json, cn } from "./ui";

const ICON: Record<Step["kind"], React.ReactNode> = {
  classify: <Sparkles className="h-3.5 w-3.5" />,
  retrieve: <Database className="h-3.5 w-3.5" />,
  plan: <Brain className="h-3.5 w-3.5" />,
  policy: <ShieldAlert className="h-3.5 w-3.5" />,
  tool: <Wrench className="h-3.5 w-3.5" />,
  verify: <ShieldCheck className="h-3.5 w-3.5" />,
  memory: <Database className="h-3.5 w-3.5" />,
  approval: <Hand className="h-3.5 w-3.5" />,
};

function title(s: Step) {
  switch (s.kind) {
    case "classify": return "Classified incident";
    case "retrieve": return s.note ? "Memory retrieval" : `Retrieved ${(s.result as unknown[])?.length ?? 0} governed memories`;
    case "plan": return s.tool ? `Decided: ${s.tool}` : "Decision";
    case "tool": return s.tool ?? "tool";
    case "verify": return "Independent verification";
    case "memory": return "Memory update";
    case "approval": return "Approval gate";
    default: return s.kind;
  }
}

function StepRow({ s, compact }: { s: Step; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const verify = s.kind === "verify" ? (s.result as { allowed: boolean } | undefined) : undefined;
  const blocked = s.note?.startsWith("REJECTED") || s.note?.startsWith("BLOCKED");
  const dot = verify ? (verify.allowed ? "bg-ok" : "bg-bad")
    : blocked ? "bg-bad" : s.kind === "tool" && s.state_changing ? "bg-warn" : s.kind === "plan" ? "bg-brand" : "bg-muted/60";
  const hasDetail = s.result !== undefined || s.rationale || s.args;
  return (
    <li className="relative pl-6">
      <span className={cn("absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-panel", dot)} />
      <button className="flex w-full items-start gap-2 text-left" onClick={() => hasDetail && setOpen(!open)}>
        <span className="mt-0.5 text-muted">{ICON[s.kind]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("text-sm", s.kind === "tool" && "font-mono text-[13px]")}>{title(s)}</span>
            {s.kind === "tool" && (s.state_changing ? <Badge tone="warn">state-changing</Badge> : <Badge>read-only</Badge>)}
            {verify && <Badge tone={verify.allowed ? "ok" : "bad"}>{verify.allowed ? "access verified" : "still denied"}</Badge>}
            {s.memory_ids_used && s.memory_ids_used.length > 0 && (
              <Badge tone="brand"><Database className="h-3 w-3" />cites {s.memory_ids_used.join(", ")}</Badge>
            )}
          </div>
          {!compact && s.kind === "plan" && s.rationale && <p className="mt-0.5 text-xs text-muted line-clamp-2">{s.rationale}</p>}
          {s.note && <p className={cn("mt-0.5 text-xs", blocked ? "text-bad" : "text-muted")}>{s.note}</p>}
        </div>
        {hasDetail && (open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />)}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {s.hypothesis && <p className="text-xs"><span className="text-muted">Hypothesis: </span>{s.hypothesis}</p>}
          {s.rationale && <p className="text-xs"><span className="text-muted">Rationale: </span>{s.rationale}</p>}
          {s.args && <Json value={s.args} />}
          {s.result !== undefined && <Json value={s.result} />}
        </div>
      )}
    </li>
  );
}

export function RunTimeline({ steps, compact }: { steps: Step[]; compact?: boolean }) {
  if (!steps?.length) return <p className="text-sm text-muted">No steps yet.</p>;
  return (
    <ol className="relative space-y-3 before:absolute before:left-[4.5px] before:top-2 before:bottom-2 before:w-px before:bg-line">
      {steps.map((s) => <StepRow key={s.n} s={s} compact={compact} />)}
    </ol>
  );
}

export function StepSearchIcon() { return <Search className="h-4 w-4" />; }
