"use client";
import { FileCode, Files, Layers, Network, ShieldCheck, X } from "lucide-react";
import { pageTitle, useApp, type SidebarPanel } from "@/components/AppState";
import { ChatPanel } from "@/components/ide/ChatPanel";
import { ManageGroupButton } from "@/components/ide/ManageGroupButton";
import { CodeEditor } from "@/components/ide/CodeEditor";
import { Sidebar } from "@/components/ide/Sidebar";
import { StatusBar } from "@/components/ide/StatusBar";
import { UserMenu } from "@/components/ide/UserMenu";
import { SettingsView } from "@/components/settings/SettingsView";
import { Badge, cn } from "@/components/ui";
import { ApprovalsView } from "@/components/views/ApprovalsView";
import { CompareView } from "@/components/views/CompareView";
import { GovernanceOverview } from "@/components/views/GovernanceGuide";
import { ExplorerView } from "@/components/views/ExplorerView";
import { HistoryView } from "@/components/views/HistoryView";
import { MemoryView } from "@/components/views/MemoryView";
import { RunsView } from "@/components/views/RunsView";
import type { PageId, Tab } from "@/lib/types";

const ACTIVITY: { id: SidebarPanel; icon: typeof Files; label: string }[] = [
  { id: "files", icon: Files, label: "Explorer" },
  { id: "arch", icon: Network, label: "Architecture" },
  { id: "gov", icon: ShieldCheck, label: "Governance" },
];

export function Ide() {
  const { workspace, repo, group, groupMembers, closeWorkspace, tabs, activeTabId, setActiveTabId, closeTab, sidebar, setSidebar, openArch, openPage, pendingCount, can } = useApp();
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  const name = workspace?.kind === "local" ? workspace.name : workspace?.kind === "group" ? group?.name ?? "" : repo?.full_name ?? "";
  const chatKey = workspace?.kind === "repo" ? workspace.repoId : workspace?.kind === "group" ? `group:${workspace.groupId}` : `local:${name}`;
  const indexed = workspace?.kind === "repo" || workspace?.kind === "group";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="flex gap-1.5"><span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" /></div>
        <div className="ml-2 flex items-center gap-1.5 text-xs"><Layers className="h-3.5 w-3.5 text-brand" /><span className="font-semibold">ArchMind</span><span className="text-muted">— {name}</span></div>
        <div className="ml-auto flex items-center gap-2">
          {workspace?.kind === "local" && <Badge tone="info">local files · GitHub provenance unavailable</Badge>}
          {workspace?.kind === "group" && <Badge tone="brand">repo group · {groupMembers.length} repositor{groupMembers.length === 1 ? "y" : "ies"}</Badge>}
          {workspace?.kind === "group" && <ManageGroupButton />}
          <button onClick={closeWorkspace} className="rounded-md px-2 py-0.5 text-[11px] text-muted hover:bg-line/50 hover:text-fg">Close workspace</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Activity bar" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel/80 py-2">
          {ACTIVITY.map(({ id, icon: Icon, label }) => (
            <button key={id} title={label} aria-label={label} aria-pressed={sidebar === id} onClick={() => { setSidebar(id); if (id === "arch" && indexed) openArch(); if (id === "gov" && sidebar !== "gov") openPage("governance"); }}
              className={cn("relative grid h-10 w-10 place-items-center rounded-lg", sidebar === id ? "text-fg" : "text-muted hover:text-fg")}>
              {sidebar === id && <span className="absolute left-[-6px] h-5 w-[2px] rounded bg-brand" />}
              <Icon className="h-5 w-5" />
              {id === "gov" && can("approve_memory") && pendingCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-warn" />}
            </button>
          ))}
          <div className="mt-auto"><UserMenu /></div>
        </nav>

        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <div role="tablist" className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-line bg-panel/60">
            {tabs.map((t) => (
              <div key={t.id} role="tab" aria-selected={t.id === activeTabId} tabIndex={0} onClick={() => setActiveTabId(t.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setActiveTabId(t.id); }}
                className={cn("group flex h-full cursor-pointer items-center gap-2 border-r border-line px-3 text-xs", t.id === activeTabId ? "bg-bg text-fg shadow-[inset_0_2px_0_#7c8cff]" : "text-muted hover:text-fg")}>
                <TabIcon tab={t} /><span className="whitespace-nowrap">{tabTitle(t)}</span>
                <button onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} aria-label={`Close ${tabTitle(t)}`} className="rounded p-0.5 opacity-0 hover:bg-line/60 focus:opacity-100 group-hover:opacity-100"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
          <div className="min-h-0 flex-1 bg-bg/40">
            {!active && <EmptyEditor />}
            {active?.kind === "file" && <CodeEditor key={active.path} path={active.path} />}
            {active?.kind === "arch" && <ExplorerView />}
            {active?.kind === "page" && <div className="h-full overflow-y-auto px-5 py-4"><Page page={active.page} /></div>}
          </div>
        </div>

        <aside aria-label="AI assistant" className="w-[400px] shrink-0 border-l border-line bg-panel/50"><ChatPanel key={chatKey} /></aside>
      </div>

      <StatusBar />
    </div>
  );
}

const tabTitle = (t: Tab) => (t.kind === "file" ? t.path.split("/").pop() ?? t.path : t.kind === "arch" ? "Architecture Explorer" : pageTitle(t.page));

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "file") return <FileCode className="h-3.5 w-3.5 text-info/80" />;
  if (tab.kind === "arch") return <Network className="h-3.5 w-3.5 text-brand" />;
  return <ShieldCheck className="h-3.5 w-3.5 text-ok" />;
}

function Page({ page }: { page: PageId }) {
  switch (page) {
    case "governance": return <GovernanceOverview />;
    case "memory": return <MemoryView />;
    case "approvals": return <ApprovalsView />;
    case "history": return <HistoryView />;
    case "runs": return <RunsView />;
    case "compare": return <CompareView />;
    case "settings": return <SettingsView />;
  }
}

function EmptyEditor() {
  const { workspace, setSidebar, groupMembers } = useApp();
  if (workspace?.kind === "group" && groupMembers.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-xs text-muted">
        <div className="max-w-sm space-y-3">
          <Layers className="mx-auto h-8 w-8 text-line" />
          <p className="text-sm text-fg">This group has no repositories yet</p>
          <p className="leading-relaxed">Add repositories that are already connected, or connect new ones from GitHub. Once they are indexed, the group map shows how they call each other.</p>
          <ManageGroupButton variant="button" className="mx-auto" />
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full place-items-center px-6 text-center text-xs text-muted">
      <div className="space-y-2">
        <Layers className="mx-auto h-8 w-8 text-line" />
        <p>Open a file from the explorer, then select code and ask why it exists.</p>
        {(workspace?.kind === "repo" || workspace?.kind === "group") && <button onClick={() => setSidebar("files")} className="text-brand hover:underline">Browse files</button>}
      </div>
    </div>
  );
}
