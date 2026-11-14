"use client";
import { Brain, ChevronDown, Check, FileCode, Files, GitBranch, Network, ShieldCheck, X, FolderOpen, Layers } from "lucide-react";
import { useRef, useState } from "react";
import { pageTitle, useApp, type SidebarPanel } from "@/components/AppState";
import { ChatPanel } from "@/components/ide/ChatPanel";
import { CodeEditor } from "@/components/ide/CodeEditor";
import { FileTree } from "@/components/ide/FileTree";
import { Badge, cn } from "@/components/ui";
import { ApprovalsView } from "@/components/views/ApprovalsView";
import { CompareView } from "@/components/views/CompareView";
import { ExplorerView } from "@/components/views/ExplorerView";
import { HistoryView } from "@/components/views/HistoryView";
import { MemoryView } from "@/components/views/MemoryView";
import { RunsView } from "@/components/views/RunsView";
import { readFolder } from "@/lib/localFiles";
import { NODES, REPO, USERS } from "@/lib/mock";
import type { Tab, ViewId } from "@/lib/types";

const ACTIVITY: { id: SidebarPanel; icon: typeof Files; label: string }[] = [
  { id: "files", icon: Files, label: "Explorer" },
  { id: "arch", icon: Network, label: "Architecture" },
  { id: "gov", icon: ShieldCheck, label: "Governance" },
];

const GOV_PAGES: { page: ViewId; label: string }[] = [
  { page: "memory", label: "Memory Inspector" },
  { page: "approvals", label: "Approval Center" },
  { page: "history", label: "Decision History" },
  { page: "runs", label: "Agent Run Inspector" },
  { page: "compare", label: "Memory Impact" },
];

export function Ide() {
  const { workspace, closeWorkspace, tabs, activeTabId, setActiveTabId, closeTab, sidebar, setSidebar, user, setUserId, memories, memoryOn, openPage, openWorkspace } = useApp();
  const [userMenu, setUserMenu] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  const pending = memories.filter((m) => m.status === "pending" && m.tenant === user.tenant).length;

  const swapFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const r = await readFolder(e.target.files);
    if (Object.keys(r.files).length) openWorkspace({ name: r.name, source: "local", demo: false, files: r.files });
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* title bar */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="flex gap-1.5"><span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" /></div>
        <div className="ml-2 flex items-center gap-1.5 text-xs"><Layers className="h-3.5 w-3.5 text-brand" /><span className="font-semibold">ArchMind</span><span className="text-muted">— {workspace?.name}</span></div>
        <div className="ml-auto flex items-center gap-2">
          {workspace?.demo ? <Badge tone="warn">synthetic demo data · backend not connected</Badge> : <Badge tone="info">local files · integrations not connected</Badge>}
          <button onClick={closeWorkspace} className="rounded-md px-2 py-0.5 text-[11px] text-muted hover:bg-line/50 hover:text-fg">Close workspace</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* activity bar */}
        <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel/80 py-2">
          {ACTIVITY.map(({ id, icon: Icon, label }) => (
            <button key={id} title={label} onClick={() => { setSidebar(id); if (id === "arch") openPage("explorer"); }}
              className={cn("relative grid h-10 w-10 place-items-center rounded-lg", sidebar === id ? "text-fg" : "text-muted hover:text-fg")}>
              {sidebar === id && <span className="absolute left-[-6px] h-5 w-[2px] rounded bg-brand" />}
              <Icon className="h-5 w-5" />
              {id === "gov" && pending > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-warn" />}
            </button>
          ))}
          <div className="relative mt-auto">
            <button onClick={() => setUserMenu((o) => !o)} title={`${user.name} · ${user.tenantName}`} className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">{user.name.split(" ").map((p) => p[0]).join("")}</button>
            {userMenu && (
              <div className="absolute bottom-0 left-11 z-40 w-64 rounded-lg border border-line bg-panel-2 p-1 shadow-xl">
                <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted">Switch demo identity</div>
                {USERS.map((u) => (
                  <button key={u.id} onClick={() => { setUserId(u.id); setUserMenu(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-line/50">
                    <div className="min-w-0 flex-1"><div className="truncate text-xs">{u.name}</div><div className="truncate text-[11px] text-muted">{u.tenantName} · {u.team}</div></div>
                    {u.id === user.id && <Check className="h-3.5 w-3.5 text-ok" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* side bar */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel/50">
          <div className="flex items-center justify-between px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted">
            <span>{sidebar === "files" ? "Explorer" : sidebar === "arch" ? "Architecture" : "Governance"}</span>
            {sidebar === "files" && <button onClick={() => folderRef.current?.click()} title="Open another folder" className="text-muted hover:text-fg"><FolderOpen className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {sidebar === "files" && <><div className="truncate px-3 pb-1 font-mono text-[11px] text-fg">{workspace?.name}</div><FileTree /></>}
            {sidebar === "arch" && <ArchSide />}
            {sidebar === "gov" && (
              <div className="px-2 py-1">
                {GOV_PAGES.map((g) => (
                  <button key={g.page} onClick={() => openPage(g.page)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-line/40 hover:text-fg">
                    <Brain className="h-3.5 w-3.5" />{g.label}{g.page === "approvals" && pending > 0 && <Badge tone="warn" className="ml-auto">{pending}</Badge>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input ref={folderRef} type="file" className="hidden" onChange={swapFolder} {...({ webkitdirectory: "", directory: "" } as object)} />
        </aside>

        {/* editor area */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-line bg-panel/60">
            {tabs.map((t) => (
              <div key={t.id} onClick={() => setActiveTabId(t.id)}
                className={cn("group flex h-full cursor-pointer items-center gap-2 border-r border-line px-3 text-xs", t.id === activeTabId ? "bg-bg text-fg shadow-[inset_0_2px_0_#7c8cff]" : "text-muted hover:text-fg")}>
                <TabIcon tab={t} /><span className="whitespace-nowrap">{tabTitle(t)}</span>
                <button onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} className="rounded p-0.5 opacity-0 hover:bg-line/60 group-hover:opacity-100"><X className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
          <div className="min-h-0 flex-1 bg-bg/40">
            {!active && <EmptyEditor />}
            {active?.kind === "file" && <CodeEditor key={active.path} path={active.path} />}
            {active?.kind === "arch" && <div className="h-full overflow-y-auto px-5 py-4"><ExplorerView /></div>}
            {active?.kind === "page" && <div className="h-full overflow-y-auto px-5 py-4"><Page page={active.page} /></div>}
          </div>
        </div>

        {/* AI panel */}
        <aside className="w-[400px] shrink-0 border-l border-line bg-panel/50"><ChatPanel /></aside>
      </div>

      {/* status bar */}
      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-muted">
        <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{workspace?.demo ? REPO.branch : "local"}</span>
        <span>{Object.keys(workspace?.files ?? {}).length} files</span>
        <span className="ml-auto">tenant {user.tenant}</span>
        <span className={memoryOn ? "text-ok" : ""}>memory {memoryOn ? "on" : "off"}</span>
        <span>{user.name}</span>
      </div>
    </div>
  );
}

const tabTitle = (t: Tab) => (t.kind === "file" ? t.path.split("/").pop() : t.kind === "arch" ? "Architecture Explorer" : pageTitle(t.page));
function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "file") return <FileCode className="h-3.5 w-3.5 text-info/80" />;
  if (tab.kind === "arch") return <Network className="h-3.5 w-3.5 text-brand" />;
  return <ShieldCheck className="h-3.5 w-3.5 text-ok" />;
}

function Page({ page }: { page: ViewId }) {
  switch (page) {
    case "memory": return <MemoryView />;
    case "approvals": return <ApprovalsView />;
    case "history": return <HistoryView />;
    case "runs": return <RunsView />;
    case "compare": return <CompareView />;
    default: return <ExplorerView />;
  }
}

function EmptyEditor() {
  const { openPage } = useApp();
  return (
    <div className="grid h-full place-items-center text-center text-xs text-muted">
      <div className="space-y-2">
        <Layers className="mx-auto h-8 w-8 text-line" />
        <p>Open a file from the explorer, then select code and ask why it exists.</p>
        <button onClick={() => openPage("explorer")} className="text-brand hover:underline">Open Architecture Explorer</button>
      </div>
    </div>
  );
}

function ArchSide() {
  const { workspace, openPage, setSelectedNode, selectedNode } = useApp();
  if (!workspace?.demo) return <p className="px-3 py-2 text-xs leading-relaxed text-muted">Architecture extraction for local folders is not built yet. Open the demo repository to explore the graph.</p>;
  return (
    <div className="px-2 py-1">
      {NODES.filter((n) => !n.ghost).map((n) => (
        <button key={n.id} onClick={() => { setSelectedNode(n.id); openPage("explorer"); }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-line/40", selectedNode === n.id ? "bg-brand-soft text-fg" : "text-muted")}>
          <span className={cn("h-2 w-2 rounded-sm", n.kind === "service" ? "bg-brand" : n.kind === "module" ? "bg-info" : n.kind === "datastore" ? "bg-ok" : "bg-muted")} />{n.label}
          {n.memoryIds.length > 0 && <span className="ml-auto text-[10px] text-brand">◆{n.memoryIds.length}</span>}
        </button>
      ))}
    </div>
  );
}
