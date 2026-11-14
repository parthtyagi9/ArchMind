"use client";
import { AlertOctagon, Brain, CheckCircle2, HelpCircle, Network, ShieldAlert } from "lucide-react";
import { useApp } from "@/components/AppState";
import { Badge, Button, RichText, cn } from "@/components/ui";
import { memoryIdOfRef } from "@/lib/format";
import type { Answer, Verdict } from "@/lib/types";

export const VERDICT_META: Record<Verdict, { label: string; icon: typeof CheckCircle2; cls: string; blurb: string }> = {
  proceed: { label: "Proceed", icon: CheckCircle2, cls: "border-ok/40 bg-ok-soft text-ok", blurb: "No blocking decision or constraint was found." },
  proceed_with_constraints: { label: "Proceed with constraints", icon: ShieldAlert, cls: "border-warn/40 bg-warn-soft text-warn", blurb: "You can change it, but governed memory sets conditions." },
  needs_architecture_review: { label: "Needs architecture review", icon: AlertOctagon, cls: "border-bad/40 bg-bad-soft text-bad", blurb: "Do not change this without an architecture review." },
  insufficient_evidence: { label: "Insufficient evidence", icon: HelpCircle, cls: "border-line bg-line/40 text-muted", blurb: "The agents did not find enough evidence to decide." },
};

export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict; size?: "sm" | "md" }) {
  const m = VERDICT_META[verdict];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-lg border font-semibold", size === "md" ? "px-3 py-1.5 text-xs" : "px-2 py-0.5 text-[11px]", m.cls)}>
      <Icon className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} />{m.label}
    </span>
  );
}

const CONF_TONE = { low: "bad", medium: "warn", high: "ok" } as const;

/** Recommendation, constraints (linked to their memory) and risks. Shared by the chat answer and Memory Impact. */
export function GuidanceBlock({ guidance }: { guidance: Answer["guidance"] }) {
  const { openMemory } = useApp();
  return (
    <div className="space-y-2.5">
      <div className={cn("rounded-md border p-2.5 text-xs", guidance.verdict === "proceed" ? "border-line bg-panel-2" : VERDICT_META[guidance.verdict].cls)}>
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider opacity-80">Recommendation</div>
        <div className="text-fg"><RichText text={guidance.recommendation} /></div>
      </div>

      {guidance.constraints.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">Constraints from governed memory</div>
          <ul className="space-y-1.5 text-xs">
            {guidance.constraints.map((c, i) => (
              <li key={`${c.memory_ref}-${i}`} className="flex gap-1.5">
                <Brain className="mt-0.5 h-3 w-3 shrink-0 text-ok" />
                <span className="min-w-0 flex-1"><RichText text={c.text} />{" "}
                  <button onClick={() => openMemory(memoryIdOfRef(c.memory_ref))} title="Open in Memory Inspector" className="align-middle"><Badge tone="ok" className="font-mono">◆ {c.memory_ref}</Badge></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {guidance.risks.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">Risks</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">{guidance.risks.map((r, i) => <li key={i}><RichText text={r} /></li>)}</ul>
        </div>
      )}
    </div>
  );
}

interface Props {
  answer: Answer;
  memoryEnabled: boolean;
  memoriesUsed: number;
  runId: string;
  canShowGraph: boolean;
  onEvidence: (ref: string) => void;
  footer?: React.ReactNode;
}

export function AnswerCard({ answer, memoryEnabled, memoriesUsed, runId, canShowGraph, onEvidence, footer }: Props) {
  const { showInArchitecture } = useApp();
  const g = answer.guidance;
  return (
    <div className="rounded-lg border border-line bg-panel p-3 text-[12.5px] leading-relaxed">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={g.verdict} />
        <Badge tone={CONF_TONE[answer.confidence]}>confidence: {answer.confidence}</Badge>
        <span className="ml-auto font-mono text-[10px] text-muted">{runId}</span>
      </div>
      <p className="mb-2 text-[11px] text-muted">{VERDICT_META[g.verdict].blurb}</p>
      <div className="mb-1.5 text-sm font-semibold"><RichText text={answer.headline} /></div>
      {answer.explanation.map((p, i) => <p key={i} className="mb-2 text-fg/90"><RichText text={p} /></p>)}

      <GuidanceBlock guidance={g} />

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone={memoriesUsed > 0 ? "ok" : "neutral"}>{!memoryEnabled ? "memory off for this run" : memoriesUsed > 0 ? `memory-informed · ${memoriesUsed} used` : "no memory applied"}</Badge>
      </div>

      {answer.evidence_refs.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">Evidence</div>
          <div className="flex flex-wrap gap-1">
            {answer.evidence_refs.map((e) => <button key={e} onClick={() => onEvidence(e)} title="Show this finding"><Badge className="font-mono hover:bg-line">{e}</Badge></button>)}
          </div>
        </div>
      )}

      {answer.affected_components.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">Affected components</div>
          <div className="flex flex-wrap gap-1">{answer.affected_components.map((c) => <Badge key={c} tone="brand" className="font-mono">{c}</Badge>)}</div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-2.5">
        {canShowGraph && answer.affected_components.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => showInArchitecture(answer.affected_components)}><Network className="h-3.5 w-3.5" />Show in architecture</Button>
        )}
        {footer}
      </div>
    </div>
  );
}
