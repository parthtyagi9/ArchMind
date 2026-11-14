"use client";
import { BookOpen, Brain, FileCode, GitCommit, GitPullRequest, Ticket } from "lucide-react";
import { Badge, ExtLink, cn } from "@/components/ui";
import type { Finding, FindingKind } from "@/lib/types";

export const FINDING_ICON: Record<FindingKind, typeof GitCommit> = {
  commit: GitCommit, pull_request: GitPullRequest, issue: Ticket, page: BookOpen, memory: Brain, code: FileCode,
};

export const FINDING_LABEL: Record<FindingKind, string> = {
  commit: "commit", pull_request: "pull request", issue: "issue", page: "page", memory: "memory", code: "code",
};

/** A finding as a row: kind icon, ref, title, detail, and an external link when the API gives a url. */
export function FindingRow({ f, onOpen, focused }: { f: Finding; onOpen?: () => void; focused?: boolean }) {
  const Icon = FINDING_ICON[f.kind];
  return (
    <div data-finding-ref={f.ref} className={cn("rounded-md px-1.5 py-1 text-[11px]", focused && "bg-warn/10 ring-1 ring-warn/40")}>
      <div className="flex items-start gap-1.5">
        <Icon className={cn("mt-0.5 h-3 w-3 shrink-0", f.kind === "memory" ? "text-ok" : "text-brand")} aria-label={FINDING_LABEL[f.kind]} />
        {onOpen
          ? <button onClick={onOpen} className="shrink-0 font-mono text-brand hover:underline">{f.ref}</button>
          : <span className="shrink-0 font-mono text-brand">{f.ref}</span>}
        <span className="min-w-0 flex-1 break-words text-fg">{f.title}</span>
        {f.url && <ExtLink href={f.url} className="shrink-0"><span className="sr-only">Open {f.ref}</span></ExtLink>}
      </div>
      {f.detail && <div className="mt-0.5 whitespace-pre-wrap break-words pl-[18px] text-muted">{f.detail}</div>}
    </div>
  );
}

export function FindingChip({ f, onClick }: { f: Finding; onClick?: () => void }) {
  const Icon = FINDING_ICON[f.kind];
  const isMem = f.kind === "memory";
  const label = isMem && f.title ? (f.title.length > 38 ? `${f.title.slice(0, 37)}…` : f.title) : f.ref;
  const tip = isMem ? `${f.title} (${f.ref})` : f.title;
  const inner = <Badge tone={isMem ? "ok" : "brand"} className={isMem ? "max-w-full" : "font-mono"}><Icon className="h-3 w-3 shrink-0" /><span className="truncate">{label}</span></Badge>;
  return onClick ? <button onClick={onClick} title={tip} className="max-w-full">{inner}</button> : <span title={tip} className="max-w-full">{inner}</span>;
}
