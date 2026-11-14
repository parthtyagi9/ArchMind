"use client";
import { ChevronDown, ChevronRight, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { ArchGraph } from "@/components/views/ArchGraph";
import { ArchMapView } from "@/components/views/ArchMapView";
import { ComponentPanel } from "@/components/views/ComponentPanel";
import { ManageGroupButton } from "@/components/ide/ManageGroupButton";
import { Badge, Button, Empty, ErrorBanner, LoadingBlock, Skeleton } from "@/components/ui";
import { useRepoGraph } from "@/lib/repoData";
import { useGroupGraph } from "@/lib/groupData";
import { api, errorMessage } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import type { GroupGraph, Repo } from "@/lib/types";

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto px-5 py-4"><div className="mx-auto max-w-xl pt-10">{children}</div></div>;
}

export function ExplorerView() {
  const { workspace, repo, group, groupMembers } = useApp();
  if (workspace?.kind === "group") {
    return group ? <ArchMapView source={{ kind: "group", group, members: groupMembers }} folders={<GroupExplorer />} /> : <GroupExplorer />;
  }
  if (workspace?.kind === "repo" && repo) return <ArchMapView source={{ kind: "repo", repo }} folders={<RepoExplorer />} />;
  return <RepoExplorer />;
}

function GroupExplorer() {
  const { group, groupMembers, selectedNode, setSelectedNode, highlight, setHighlight } = useApp();
  const graph = useGroupGraph(group, groupMembers);
  if (!group) return <Shell><Empty>Group not found. Return to the workspace picker.</Empty></Shell>;
  if (graph.loading && !graph.data) return <div className="p-5"><Skeleton className="h-[420px]" /><LoadingBlock label="Loading group map…" /></div>;
  if (graph.error != null) return <Shell><ErrorBanner error={graph.error} onRetry={graph.reload} /></Shell>;
  const g = graph.data;
  if (!g || g.nodes.length === 0) {
    return (
      <Shell>
        <Empty>{groupMembers.length === 0 ? "This group has no repositories yet. Add or connect some to build the group map." : "No components yet. The map appears once member repositories finish indexing."}</Empty>
        {groupMembers.length === 0 && <div className="mt-3 flex justify-center"><ManageGroupButton variant="button" /></div>}
      </Shell>
    );
  }
  const activeNode = selectedNode && g.nodes.some((n) => n.id === selectedNode) ? selectedNode : null;
  const stale = g.repos.filter((r) => r.status === "ready" && !r.interfaces_indexed);
  const notReady = g.repos.filter((r) => r.status !== "ready");
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
          <span className="font-semibold">Group map</span>
          <ManageGroupButton className="order-last ml-auto" />
          <span className="text-muted">{group.name} · {g.repos.length} repositor{g.repos.length === 1 ? "y" : "ies"} · {g.nodes.length} components · {g.stats.cross_repo_edges} cross-repo link{g.stats.cross_repo_edges === 1 ? "" : "s"}</span>
          {g.repos.length > 1 && g.stats.cross_repo_edges === 0 && stale.length === 0 && <Badge tone="warn">no calls or shared packages found between these repositories</Badge>}
          {highlight.length > 0 && (
            <button onClick={() => setHighlight([])} className="ml-auto flex items-center gap-1 rounded-md bg-warn-soft px-2 py-1 text-[12px] text-warn hover:bg-warn/20">
              <X className="h-3 w-3" />Clear {highlight.length} highlighted component{highlight.length === 1 ? "" : "s"} from agent answer
            </button>
          )}
        </div>
        {stale.length > 0 && <StaleBanner repos={stale.map((r) => r.id)} onDone={graph.reload} />}
        {notReady.length > 0 && <div className="border-b border-line bg-info-soft px-4 py-1.5 text-[12px] text-info">{notReady.map((r) => `${r.full_name} (${r.status})`).join(", ")}: not on the map until indexing succeeds.</div>}
        <div className="relative min-h-0 flex-1 canvas-dots">
          <ArchGraph key={`${group.id}:${group.updated_at}:${g.repos.map((r) => r.id).join(",")}`} graph={g} grouped selected={activeNode} highlight={highlight} onSelect={setSelectedNode} />
        </div>
        <Unmatched g={g} />
      </div>
      {activeNode && <div className="w-[400px] shrink-0"><ComponentPanel source={{ kind: "group", group }} nodeId={activeNode} onSelect={setSelectedNode} onClose={() => setSelectedNode(null)} /></div>}
    </div>
  );
}

/** Repositories indexed before API/package detection existed have no interfaces until they are reindexed. */
function StaleBanner({ repos, onDone }: { repos: string[]; onDone: () => void }) {
  const { repos: all, upsertRepo, can } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const names = repos.map((id) => all.find((r) => r.id === id)?.full_name ?? id);
  const reindex = async () => {
    setBusy(true); setErr(null);
    try {
      const out: Repo[] = await Promise.all(repos.map((id) => { invalidate(`${id}|`); return api.reindexRepo(id); }));
      out.forEach(upsertRepo);
      onDone();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-warn-soft px-4 py-1.5 text-[12px] text-warn">
      <span>{names.join(", ")} {names.length === 1 ? "was" : "were"} indexed before API and package detection. Reindex to find connections.</span>
      <Button size="sm" variant="outline" disabled={busy || !can("connect_repo")} onClick={() => void reindex()} title={can("connect_repo") ? undefined : "Requires the connect_repo permission"}>
        <RefreshCw className="h-3 w-3" />Reindex {names.length === 1 ? "it" : `all ${names.length}`}
      </Button>
      {err && <span className="text-bad">{err}</span>}
    </div>
  );
}

function Unmatched({ g }: { g: GroupGraph }) {
  const [open, setOpen] = useState(false);
  if (g.unmatched_calls.length === 0) return null;
  return (
    <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-line bg-panel/60 text-[12px]">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-muted hover:text-fg">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {g.unmatched_calls.length}{g.unmatched_calls.length >= 100 ? "+" : ""} HTTP call{g.unmatched_calls.length === 1 ? "" : "s"} not served by any repository in this group (external APIs, or routes this analysis could not read)
      </button>
      {open && (
        <table className="mb-2 w-full font-mono text-[11.5px]">
          <tbody>
            {g.unmatched_calls.map((c, i) => (
              <tr key={i} className="border-t border-line/50">
                <td className="w-14 px-4 py-0.5 text-info">{c.method}</td>
                <td className="py-0.5">{c.host && <span className="text-muted">{c.host}</span>}{c.path}</td>
                <td className="px-4 py-0.5 text-right text-muted">{c.repo_name}:{c.file}:{c.line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RepoExplorer() {
  const { repo, workspace, selectedNode, setSelectedNode, highlight, setHighlight, can, upsertRepo } = useApp();
  const graph = useRepoGraph(repo);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (workspace?.kind === "local") {
    return <Shell><Empty>The architecture graph is derived from the import statements of an indexed repository. Local files are not indexed. Connect the repository from the workspace picker to explore it.</Empty></Shell>;
  }
  if (!repo) return <Shell><Empty>Repository not found. Return to the workspace picker.</Empty></Shell>;
  if (repo.status === "indexing") {
    const { done, total } = repo.progress;
    return (
      <Shell>
        <div className="rounded-xl border border-line bg-panel/80 p-5 text-center text-xs" role="status">
          <div className="text-sm font-medium">Indexing {repo.full_name}</div>
          <div className="mx-auto mt-3 h-1.5 max-w-xs overflow-hidden rounded-full bg-line/60"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 5}%` }} /></div>
          <p className="mt-2 text-muted">{total > 0 ? `${done} of ${total} files` : "Preparing index…"} · the graph appears when indexing finishes.</p>
        </div>
      </Shell>
    );
  }
  if (repo.status === "failed") {
    const reindex = async () => {
      setBusy(true); setErr(null);
      try { upsertRepo(await api.reindexRepo(repo.id)); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
    };
    return (
      <Shell>
        <ErrorBanner error={`Indexing failed: ${repo.error ?? "unknown error"}`} />
        {err && <ErrorBanner error={err} className="mt-2" />}
        <Button className="mt-3" variant="outline" disabled={!can("connect_repo") || busy} onClick={() => void reindex()} title={can("connect_repo") ? undefined : "Requires the connect_repo permission"}><RefreshCw className="h-3.5 w-3.5" />Reindex</Button>
      </Shell>
    );
  }
  if (graph.loading && !graph.data) return <div className="p-5"><Skeleton className="h-[420px]" /><LoadingBlock label="Loading architecture…" /></div>;
  if (graph.error != null) return <Shell><ErrorBanner error={graph.error} onRetry={graph.reload} /></Shell>;
  const g = graph.data;
  if (!g || g.nodes.length === 0) return <Shell><Empty>No components were found. The graph is built from import statements in supported source files, and this repository has none that could be resolved.</Empty></Shell>;

  const activeNode = selectedNode && g.nodes.some((n) => n.id === selectedNode) ? selectedNode : null;
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
          <span className="font-semibold">Architecture Explorer</span>
          <span className="text-muted">{repo.full_name} · {g.nodes.length} components · {g.edges.length} dependencies</span>
          {g.edges.some((e) => e.kind === "calls_api") && <Badge tone="info">includes HTTP calls between components</Badge>}
          {g.edges.length === 0 && <Badge tone="warn">no import edges found</Badge>}
          {highlight.length > 0 && (
            <button onClick={() => setHighlight([])} className="ml-auto flex items-center gap-1 rounded-md bg-warn-soft px-2 py-1 text-[12px] text-warn hover:bg-warn/20">
              <X className="h-3 w-3" />Clear {highlight.length} highlighted component{highlight.length === 1 ? "" : "s"} from agent answer
            </button>
          )}
        </div>
        <div className="relative min-h-0 flex-1 canvas-dots">
          <ArchGraph key={`${repo.id}:${repo.indexed_at}`} graph={g} selected={activeNode} highlight={highlight} onSelect={setSelectedNode} />
        </div>
      </div>
      {activeNode && <div className="w-[380px] shrink-0"><ComponentPanel source={{ kind: "repo", repo }} nodeId={activeNode} onSelect={setSelectedNode} onClose={() => setSelectedNode(null)} /></div>}
    </div>
  );
}
