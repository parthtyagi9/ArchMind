"use client";
import { AlertCircle, Check, GitBranch, Lock, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, ErrorBanner, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { timeAgo } from "@/lib/format";
import type { Repo } from "@/lib/types";

export function RepoCard({ repo }: { repo: Repo }) {
  const { can, upsertRepo, removeRepoLocal, openRepo } = useApp();
  const [busy, setBusy] = useState<"reindex" | "delete" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canConnect = can("connect_repo");
  const { done, total } = repo.progress;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const reindex = async () => {
    setBusy("reindex"); setError(null);
    try { invalidate(`${repo.id}|`); upsertRepo(await api.reindexRepo(repo.id)); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    setBusy("delete"); setError(null);
    try { await api.deleteRepo(repo.id); removeRepoLocal(repo.id); }
    catch (e) { setError(errorMessage(e)); setBusy(null); setConfirm(false); }
  };

  return (
    <div className="flex flex-col rounded-xl border border-line bg-panel/80 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-medium" title={repo.full_name}>{repo.full_name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{repo.branch}</span>
            {repo.private && <Badge><Lock className="h-3 w-3" />private</Badge>}
          </div>
        </div>
        <StatusPill repo={repo} />
      </div>

      {repo.status === "indexing" && (
        <div className="mt-3" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-line/60">
            <div className={`h-full rounded-full bg-brand transition-all ${total === 0 ? "w-1/4 animate-pulse" : ""}`} style={total > 0 ? { width: `${pct}%` } : undefined} />
          </div>
          <div className="mt-1 text-[12px] text-muted">{total > 0 ? `Indexed ${done} of ${total} files` : "Preparing index…"}</div>
        </div>
      )}
      {repo.status === "failed" && (
        <div role="alert" className="mt-3 flex gap-2 rounded-md bg-bad-soft px-2.5 py-2 text-[12px] text-bad">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-words">{repo.error ?? "Indexing failed."}</span>
        </div>
      )}
      {repo.status === "ready" && (
        <div className="mt-3 text-[12px] text-muted">{repo.file_count} files · indexed {timeAgo(repo.indexed_at)} · connected by {repo.connected_by}</div>
      )}
      {repo.status === "ready" && <SearchStatus repo={repo} />}

      {error && <ErrorBanner error={error} className="mt-3" />}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button size="sm" disabled={repo.status !== "ready"} onClick={() => openRepo(repo.id)} title={repo.status === "ready" ? undefined : "Available once indexing has finished"}>Open</Button>
        <Button size="sm" variant="outline" disabled={!canConnect || busy !== null || repo.status === "indexing"} onClick={() => void reindex()}
          title={canConnect ? undefined : "Requires the connect_repo permission (admin or owner)"}>
          {busy === "reindex" ? <Spinner className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />}Reindex
        </Button>
        {confirm ? (
          <span className="ml-auto flex items-center gap-1.5 text-[12px]">
            <span className="text-muted">Delete this connection?</span>
            <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void remove()}>{busy === "delete" ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3" />}Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto" disabled={!canConnect || busy !== null} onClick={() => setConfirm(true)}
            title={canConnect ? "Delete repository" : "Requires the connect_repo permission (admin or owner)"} aria-label="Delete repository">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {!canConnect && <p className="mt-2 text-[12px] text-muted">Reindexing and deleting need the admin or owner role.</p>}
    </div>
  );
}

function StatusPill({ repo }: { repo: Repo }) {
  if (repo.status === "indexing") return <Badge tone="info"><Spinner className="h-3 w-3 text-info" />indexing</Badge>;
  if (repo.status === "failed") return <Badge tone="bad">failed</Badge>;
  return <Badge tone="ok">ready</Badge>;
}

/** Semantic code search status: the agent searches code by meaning once the repository's chunks are embedded. */
function SearchStatus({ repo }: { repo: Repo }) {
  const s = repo.search;
  if (!s || s.status === "none") return <div className="mt-1 text-[11px] text-muted">Semantic code search: not built yet · Reindex to enable</div>;
  if (s.status === "disabled") return <div className="mt-1 text-[11px] text-muted">Semantic code search: off (no Voyage or Gemini key) · keyword search is used</div>;
  if (s.status === "failed") return <div className="mt-1 break-words text-[11px] text-warn" title={s.error ?? undefined}>Semantic code search failed: {s.error ?? "unknown error"} · keyword search is used</div>;
  if (s.status === "embedding") {
    const pct = s.total > 0 ? Math.min(100, Math.round((s.done / s.total) * 100)) : 0;
    return (
      <div className="mt-1.5 text-[11px] text-info" role="status">
        <div className="flex items-center gap-1.5"><Spinner className="h-3 w-3 text-info" />Building semantic code search · {s.done}/{s.total} code chunks</div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-line/60"><div className="h-full rounded-full bg-info transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
    );
  }
  return <div className="mt-1 text-[11px] text-ok">Semantic code search ready · {s.total} code chunks · {s.model}</div>;
}
