"use client";
// Developer-facing explanations for the governance area: an overview page (lifecycle, where to go, who can do what,
// how the agent uses memory) and a small "How this page works" guide shown on every governance page.
import {
  ArrowRight, Ban, BookOpenCheck, Brain, CheckCircle2, ChevronDown, ChevronRight, FileClock, GitCompareArrows,
  Hourglass, Lightbulb, ListChecks, ScrollText, ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Card, ErrorBanner, PageHeader, cn, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { Memory, PageId } from "@/lib/types";

// ------------------------------------------------------------------ vocabulary (one place, reused everywhere)
export const STATUS_INFO: Record<string, { label: string; tone: Tone; meaning: string; usedByAgent: boolean }> = {
  pending: { label: "Pending", tone: "warn", meaning: "Proposed by a member or the agent. Waiting for an admin to approve it.", usedByAgent: false },
  active: { label: "Active", tone: "ok", meaning: "Approved. The agent can retrieve it and must respect it.", usedByAgent: true },
  superseded: { label: "Superseded", tone: "neutral", meaning: "An older version, replaced when someone corrected the memory. Kept for history.", usedByAgent: false },
  invalidated: { label: "Revoked", tone: "bad", meaning: "Switched off by an admin. Never retrieved again; the record stays for audit.", usedByAgent: false },
  expired: { label: "Expired", tone: "bad", meaning: "Its expiry date passed. Excluded automatically at query time.", usedByAgent: false },
  rejected: { label: "Rejected", tone: "bad", meaning: "A proposal an admin turned down. Never retrievable.", usedByAgent: false },
  purged: { label: "Purged", tone: "bad", meaning: "Permanently deleted by an owner. Only a tombstone (ids, dates, content hash) remains.", usedByAgent: false },
};

export const GOV_NAV: { page: PageId; label: string; question: string; what: string; icon: typeof Brain }[] = [
  { page: "memory", label: "Memory Inspector", question: "What does our organization know?", icon: BookOpenCheck,
    what: "Browse, search and edit every memory in your scope: decisions, bug fixes, conventions, owners, workarounds." },
  { page: "approvals", label: "Approval Center", question: "What needs my review?", icon: ListChecks,
    what: "Approve, edit or reject knowledge proposed by members and by the agent before it can influence answers." },
  { page: "history", label: "Decision History", question: "Who changed what, and when?", icon: ScrollText,
    what: "Append-only audit log of approvals, corrections, revocations, purges, retrievals and agent runs." },
  { page: "runs", label: "Agent Run Inspector", question: "What did the agent actually do?", icon: FileClock,
    what: "Every question asked: each sub-agent's tool calls, the memories retrieved or withheld, and the final decision." },
  { page: "compare", label: "Memory Impact", question: "Did memory change the answer?", icon: GitCompareArrows,
    what: "Run the same question with and without memory, same evidence and model, and see what changed and why." },
];

// ------------------------------------------------------------------ per-page guide
const PAGE_GUIDE: Record<string, { points: string[]; who: string }> = {
  memory: {
    points: [
      "Each card is one memory. Click it to see its content, sources, scope, expiry and every version.",
      "Only Active memories are ever shown to the agent. The status filters explain what each state means.",
      "Scope controls who sees it: Organization (everyone), Repository (one repo), or Team (one team only).",
    ],
    who: "Everyone can browse. Members' new memories start Pending. Admins can correct and revoke; only owners can purge.",
  },
  approvals: {
    points: [
      "Proposals come from members (New memory) and from the agent (Propose as memory on an answer).",
      "Approving makes it Active and embeds it, so the agent can use it from the next question on.",
      "Edit before approving to fix wording; rejected proposals are never retrievable.",
    ],
    who: "Admins and owners approve or reject. Members only see their own proposals here.",
  },
  history: {
    points: [
      "Every governance action and agent run writes one event, newest first. Nothing here can be edited.",
      "Use the filters to answer questions like \"who revoked this?\" or \"which runs used memory today?\".",
      "Events store ids and decisions, never memory text, so a purged memory leaves no copy behind.",
    ],
    who: "Everyone in the organization can read the history.",
  },
  runs: {
    points: [
      "One row per question. Open it to see what the GitHub, Jira, Confluence and Memory agents found.",
      "Memory retrieval lists what was used and what was withheld by governance (wrong team, pending, expired…).",
      "Click Compare with/without memory to test whether memory changed this decision.",
    ],
    who: "Everyone can inspect runs in their organization.",
  },
  compare: {
    points: [
      "Pick a past run or type a question. Both arms reuse the same evidence and the same model.",
      "The only difference is whether governed memories are in the prompt.",
      "If the decision does not change, the page says so. That is a valid result, not an error.",
    ],
    who: "Anyone who can ask questions can run a comparison.",
  },
};

export function PageGuide({ page }: { page: keyof typeof PAGE_GUIDE }) {
  const [open, setOpen] = useState(false);
  const g = PAGE_GUIDE[page];
  return (
    <div className="mb-4 rounded-lg border border-line bg-panel/70 text-[13px]">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <span className="flex-1 text-fg/90">{g.points[0]}</span>
        <span className="flex shrink-0 items-center gap-1 text-[12px] text-brand">{open ? "Less" : "How it works"}{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-3 leading-relaxed">
          <ul className="list-disc space-y-1 pl-5 text-fg/90">{g.points.slice(1).map((pt) => <li key={pt}>{pt}</li>)}</ul>
          <p className="text-muted"><span className="font-medium text-fg/80">Who can do it: </span>{g.who}</p>
          {page === "memory" && <StatusLegend />}
        </div>
      )}
    </div>
  );
}

export function StatusLegend() {
  return (
    <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
      {Object.entries(STATUS_INFO).map(([k, s]) => (
        <div key={k} className="flex items-start gap-2">
          <Badge tone={s.tone} className="mt-0.5 shrink-0">{s.label}</Badge>
          <span className="text-muted">{s.meaning}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ overview page
const ROLE_ROWS: { action: string; member: boolean; admin: boolean; owner: boolean }[] = [
  { action: "Ask the agent, propose memories", member: true, admin: true, owner: true },
  { action: "Create memories that are Active immediately", member: false, admin: true, owner: true },
  { action: "Approve or reject proposals", member: false, admin: true, owner: true },
  { action: "Correct (new version) or revoke a memory", member: false, admin: true, owner: true },
  { action: "Connect repositories and integrations", member: false, admin: true, owner: true },
  { action: "Purge a memory permanently", member: false, admin: false, owner: true },
  { action: "Manage members and invites", member: false, admin: false, owner: true },
];

export function GovernanceOverview() {
  const { openPage, me, pendingCount, can } = useApp();
  const mems = useAsync(() => api.memories(), [], true);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of (mems.data ?? []) as Memory[]) c[m.status] = (c[m.status] ?? 0) + 1;
    return c;
  }, [mems.data]);
  const role = me.org.role as "member" | "admin" | "owner";
  const n = (s: string) => (mems.data ? counts[s] ?? 0 : "…");

  return (
    <>
      <PageHeader title="Governance"
        sub="The agent only uses knowledge a person approved, that you are allowed to see, and that has not expired." />

      {mems.error != null && <ErrorBanner error={mems.error} onRetry={mems.reload} className="mb-4" />}

      <Card className="mb-4 p-5">
        <h2 className="text-[15px] font-semibold">The life of a memory</h2>
        <p className="mb-4 mt-0.5 text-[13px] text-muted">The agent only ever sees the green box. Everything else is history.</p>
        <div className="flex flex-wrap items-stretch gap-2">
          <Stage icon={Lightbulb} title="Proposed" sub="by a teammate or by the agent" tone="neutral" />
          <Arrow />
          <Stage icon={Hourglass} title="Pending" count={n("pending")} sub="waiting for an admin" tone="warn" onClick={() => openPage("approvals")} />
          <Arrow label="approved" />
          <Stage icon={CheckCircle2} title="Active" count={n("active")} sub="used and cited by the agent" tone="ok" onClick={() => openPage("memory")} highlight />
        </div>
        <p className="mt-3 text-[13px] text-muted">
          Later an admin can <span className="text-fg">correct</span> it (new version), <span className="text-fg">revoke</span> it, or let it <span className="text-fg">expire</span>; an owner can <span className="text-fg">purge</span> it.
          Inactive so far: {n("superseded")} superseded, {n("invalidated")} revoked, {n("expired")} expired, {n("rejected")} rejected.
        </p>
      </Card>

      <h2 className="mb-2 text-[15px] font-semibold">Where do I go to…</h2>
      <div className="mb-4 grid gap-2 md:grid-cols-2">
        {GOV_NAV.map((g) => (
          <button key={g.page} onClick={() => openPage(g.page)}
            className="group flex items-start gap-3 rounded-lg border border-line bg-panel p-3.5 text-left transition-colors hover:border-brand/70">
            <g.icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[14px] font-medium">{g.question}
                {g.page === "approvals" && can("approve_memory") && pendingCount > 0 && <Badge tone="warn">{pendingCount} waiting</Badge>}
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{g.what}</p>
              <div className="mt-1.5 text-[12px] text-brand">Open {g.label}</div>
            </div>
          </button>
        ))}
      </div>

      <details className="rounded-lg border border-line bg-panel p-4 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-medium">
          <ShieldCheck className="h-4 w-4 text-brand" />Who can do what
          <span className="text-[13px] font-normal text-muted">You are {role} in {me.org.name}{me.org.team ? `, team ${me.org.team}` : ""}.</span>
        </summary>
        <table className="mt-3 w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="pb-2 font-medium">Action</th>
              {(["member", "admin", "owner"] as const).map((r) => (
                <th key={r} className={cn("pb-2 text-center font-medium capitalize", r === role && "text-brand")}>{r}{r === role ? " (you)" : ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_ROWS.map((row) => (
              <tr key={row.action} className="border-t border-line">
                <td className="py-1.5 pr-2">{row.action}</td>
                {(["member", "admin", "owner"] as const).map((r) => (
                  <td key={r} className={cn("py-1.5 text-center", r === role && "bg-brand-soft/40")}>
                    {row[r] ? <CheckCircle2 className="mx-auto h-4 w-4 text-ok" aria-label="allowed" /> : <span className="text-muted" aria-label="not allowed">–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function Stage({ icon: Icon, title, sub, count, tone, onClick, highlight }: {
  icon: typeof Brain; title: string; sub: string; count?: number | string; tone: Tone; onClick?: () => void; highlight?: boolean;
}) {
  const ring = { ok: "border-ok/50 bg-ok-soft/40", warn: "border-warn/50 bg-warn-soft/40", neutral: "border-line bg-panel-2" } as Record<string, string>;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={cn("min-w-[160px] flex-1 rounded-lg border p-3 text-left", ring[tone] ?? ring.neutral, onClick && "hover:border-brand", highlight && "shadow-[0_0_0_1px_var(--color-ok)]")}>
      <div className="flex items-center gap-2 text-[13px] font-semibold"><Icon className="h-4 w-4" />{title}
        {count !== undefined && <Badge tone={tone} className="ml-auto">{count}</Badge>}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted">{sub}</p>
    </Tag>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 text-muted">
      <ArrowRight className="h-4 w-4" />
      {label && <span className="mt-0.5 whitespace-nowrap text-[11px]">{label}</span>}
    </div>
  );
}

