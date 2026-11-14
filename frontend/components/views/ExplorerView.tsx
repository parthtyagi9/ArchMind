"use client";
import { RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { ArchGraph } from "@/components/views/ArchGraph";
import { ComponentPanel } from "@/components/views/ComponentPanel";
import { Badge, Button, Empty, ErrorBanner, LoadingBlock, Skeleton } from "@/components/ui";
import { useRepoGraph } from "@/lib/repoData";
import { api, errorMessage } from "@/lib/api";

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto px-5 py-4"><div className="mx-auto max-w-xl pt-10">{children}</div></div>;
}

export function ExplorerView() {
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
          {g.edges.length === 0 && <Badge tone="warn">no import edges found</Badge>}
          {highlight.length > 0 && (
            <button onClick={() => setHighlight([])} className="ml-auto flex items-center gap-1 rounded-md bg-warn-soft px-2 py-1 text-[11px] text-warn hover:bg-warn/20">
              <X className="h-3 w-3" />Clear {highlight.length} highlighted component{highlight.length === 1 ? "" : "s"} from agent answer
            </button>
          )}
        </div>
        <div className="relative min-h-0 flex-1 bg-[radial-gradient(circle,#1b1f2d_1px,transparent_1px)] [background-size:24px_24px]">
          <ArchGraph key={`${repo.id}:${repo.indexed_at}`} graph={g} selected={activeNode} highlight={highlight} onSelect={setSelectedNode} />
        </div>
      </div>
      {activeNode && <div className="w-[380px] shrink-0"><ComponentPanel repo={repo} nodeId={activeNode} onSelect={setSelectedNode} onClose={() => setSelectedNode(null)} /></div>}
    </div>
  );
}
