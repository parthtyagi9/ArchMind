"use client";
import { Compass, FolderOpen } from "lucide-react";
import { GOV_NAV } from "@/components/views/GovernanceGuide";
import { useMemo, useRef, useState } from "react";
import { useApp, type SidebarPanel } from "@/components/AppState";
import { FileTree } from "@/components/ide/FileTree";
import { Badge, Skeleton, ErrorBanner, cn } from "@/components/ui";
import { KIND_COLOR } from "@/components/views/ArchGraph";
import { roleColor } from "@/components/views/ArchDiagram";
import { useTheme } from "@/lib/theme";
import { useArchMap, type ArchSource } from "@/lib/archData";
import { readFolder } from "@/lib/localFiles";
import { useGroupGraph } from "@/lib/groupData";
import { useRepoGraph } from "@/lib/repoData";
import type { PageId } from "@/lib/types";

const TITLES: Record<SidebarPanel, string> = { files: "Explorer", arch: "Architecture", gov: "Governance" };

export function Sidebar() {
  const { sidebar, workspace, repo, group, openLocal } = useApp();
  const folderRef = useRef<HTMLInputElement>(null);

  const swapFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    const r = await readFolder(list).catch(() => null);
    if (r && Object.keys(r.files).length) openLocal(r.name, r.files);
    e.target.value = "";
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel/50">
      <div className="flex items-center justify-between px-3 py-2 text-[11px] font-medium text-muted">
        <span>{TITLES[sidebar]}</span>
        {sidebar === "files" && workspace?.kind === "local" && (
          <button onClick={() => folderRef.current?.click()} title="Open another local folder" aria-label="Open another local folder" className="text-muted hover:text-fg"><FolderOpen className="h-3.5 w-3.5" /></button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sidebar === "files" && (
          <>
            <div className="truncate px-3 pb-1 font-mono text-[12px] text-fg">{workspace?.kind === "local" ? workspace.name : workspace?.kind === "group" ? group?.name : repo?.full_name}</div>
            <FileTree />
          </>
        )}
        {sidebar === "arch" && <ArchSide />}
        {sidebar === "gov" && <GovSide />}
      </div>
      <input ref={folderRef} type="file" className="hidden" onChange={(e) => void swapFolder(e)} {...({ webkitdirectory: "", directory: "" } as object)} />
    </aside>
  );
}

function GovSide() {
  const { openPage, pendingCount, can, tabs, activeTabId } = useApp();
  const active = tabs.find((t) => t.id === activeTabId);
  const isActive = (p: string) => active?.kind === "page" && active.page === p;
  const item = (page: PageId, label: string, hint: string, Icon: typeof Compass, badge?: React.ReactNode) => (
    <button key={page} onClick={() => openPage(page)} title={hint}
      className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-line/40", isActive(page) ? "bg-brand-soft text-fg" : "text-muted hover:text-fg")}>
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", isActive(page) ? "text-brand" : "")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[13.5px]">{label}{badge}</span>
        <span className="block truncate text-[11.5px] text-muted/80">{hint}</span>
      </span>
    </button>
  );
  return (
    <div className="space-y-0.5 px-2 py-1">
      {item("governance", "Overview", "How memory governance works", Compass)}
      <div className="px-2 pb-1 pt-2 text-[11px] text-muted/70">Tools</div>
      {GOV_NAV.map((g) => item(g.page, g.label, g.question, g.icon,
        g.page === "approvals" && can("approve_memory") && pendingCount > 0 ? <Badge tone="warn" className="ml-auto">{pendingCount}</Badge> : undefined))}
    </div>
  );
}

function ArchSide() {
  const { workspace, repo, group, groupMembers } = useApp();
  const source = workspace?.kind === "group" && group ? { kind: "group" as const, group, members: groupMembers } : workspace?.kind === "repo" && repo ? { kind: "repo" as const, repo } : null;
  if (!source) return <RepoArchSide />;
  return <MapSide source={source} />;
}

function MapSide({ source }: { source: ArchSource }) {
  const { openArch, archFeature, setArchFeature } = useApp();
  const theme = useTheme();
  const arch = useArchMap(source);
  const [open, setOpen] = useState<string | null>(null);
  if (source.kind === "repo" && source.repo.status !== "ready") return <p className="px-3 py-2 text-xs leading-relaxed text-muted">The map is built when indexing finishes.</p>;
  if (arch.loading && !arch.data) return <div className="space-y-1.5 px-3 py-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4" />)}</div>;
  if (arch.error != null) return <div className="p-2"><ErrorBanner error={arch.error} onRetry={arch.reload} /></div>;
  const m = arch.data;
  if (!m) return null;
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  return (
    <div className="px-2 py-1">
      <button onClick={() => { setArchFeature(null); openArch(); }} className="mb-1 w-full rounded-md px-2 py-1 text-left text-[11px] text-brand hover:bg-line/40">Open architecture map</button>
      {m.features.map((f) => (
        <div key={f.id}>
          <div className={cn("flex items-center rounded-md hover:bg-line/40", archFeature === f.id && "bg-brand-soft")}>
            <button onClick={() => setOpen(open === f.id ? null : f.id)} aria-label="Expand" className="px-1 text-muted">{open === f.id ? "▾" : "▸"}</button>
            <button onClick={() => { setArchFeature(f.id); openArch(); }} className="min-w-0 flex-1 truncate py-1.5 pr-2 text-left text-[12.5px] text-fg/90" title={f.description ?? undefined}>{f.name}</button>
            <span className="pr-2 text-[10px] text-muted">{f.node_ids.length}</span>
          </div>
          {open === f.id && f.node_ids.map((id) => byId.get(id)).filter(Boolean).map((n) => (
            <div key={n!.id} className="flex items-center gap-2 py-1 pl-7 pr-2 text-[11.5px] text-muted" title={n!.description ?? undefined}>
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: roleColor(n!.role, theme) }} /><span className="truncate">{n!.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function GroupArchSide() {
  const { group, groupMembers, openArch, setSelectedNode, selectedNode } = useApp();
  const graph = useGroupGraph(group, groupMembers);
  const byRepo = useMemo(() => {
    const m = new Map<string, NonNullable<typeof graph.data>["nodes"]>();
    for (const n of graph.data?.nodes ?? []) m.set(n.repo_name ?? "", [...(m.get(n.repo_name ?? "") ?? []), n]);
    return Array.from(m.entries()).map(([name, ns]) => [name, ns.sort((a, b) => a.label.localeCompare(b.label))] as const);
  }, [graph.data]);
  if (!group) return null;
  if (graph.loading && !graph.data) return <div className="space-y-1.5 px-3 py-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4" />)}</div>;
  if (graph.error != null) return <div className="p-2"><ErrorBanner error={graph.error} onRetry={graph.reload} /></div>;
  if (byRepo.length === 0) return <p className="px-3 py-2 text-xs leading-relaxed text-muted">No components yet. They appear once member repositories finish indexing.</p>;
  const cross = graph.data?.stats.cross_repo_edges ?? 0;
  return (
    <div className="px-2 py-1">
      <button onClick={openArch} className="mb-1 w-full rounded-md px-2 py-1 text-left text-[12px] text-brand hover:bg-line/40">Open group map · {cross} cross-repo link{cross === 1 ? "" : "s"}</button>
      {byRepo.map(([name, ns]) => (
        <div key={name} className="mb-1.5">
          <div className="truncate px-2 py-1 font-mono text-[11px] text-muted" title={name}>{name}</div>
          {ns.map((n) => (
            <button key={n.id} onClick={() => { setSelectedNode(n.id); openArch(); }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] hover:bg-line/40", selectedNode === n.id ? "bg-brand-soft text-fg" : "text-muted")}>
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: KIND_COLOR[n.kind] }} /><span className="truncate">{n.label}</span>
              {n.memory_count > 0 && <span className="ml-auto text-[11px] text-brand">◆{n.memory_count}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function RepoArchSide() {
  const { workspace, repo, openArch, setSelectedNode, selectedNode } = useApp();
  const graph = useRepoGraph(repo);
  const nodes = useMemo(() => (graph.data ? [...graph.data.nodes].sort((a, b) => a.label.localeCompare(b.label)) : []), [graph.data]);

  if (workspace?.kind === "local") return <p className="px-3 py-2 text-xs leading-relaxed text-muted">The architecture graph is built from an indexed repository. Connect the repository from the workspace picker to explore it.</p>;
  if (!repo) return null;
  if (repo.status !== "ready") return <p className="px-3 py-2 text-xs leading-relaxed text-muted">The graph is built when indexing finishes.</p>;
  if (graph.loading && !graph.data) return <div className="space-y-1.5 px-3 py-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4" />)}</div>;
  if (graph.error != null) return <div className="p-2"><ErrorBanner error={graph.error} onRetry={graph.reload} /></div>;
  if (nodes.length === 0) return <p className="px-3 py-2 text-xs leading-relaxed text-muted">No components were found in this repository.</p>;
  return (
    <div className="px-2 py-1">
      {nodes.map((n) => (
        <button key={n.id} onClick={() => { setSelectedNode(n.id); openArch(); }} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] hover:bg-line/40", selectedNode === n.id ? "bg-brand-soft text-fg" : "text-muted")}>
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: KIND_COLOR[n.kind] }} /><span className="truncate">{n.label}</span>
          {n.memory_count > 0 && <span className="ml-auto text-[11px] text-brand">◆{n.memory_count}</span>}
        </button>
      ))}
    </div>
  );
}
