"use client";
import { Lock, Search } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, ErrorBanner, Field, GithubMark, InfoBanner, LoadingBlock, Modal, Spinner, inputCls } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAsync, useDebounced } from "@/lib/hooks";
import { timeAgo } from "@/lib/format";

export function ConnectRepoModal({ onClose }: { onClose: () => void }) {
  const { repos, integrations, upsertRepo } = useApp();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const list = useAsync(() => api.githubRepos(dq || undefined), [dq]);
  const [manual, setManual] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connected = list.data?.connected === true;
  const oauth = integrations?.github.oauth_configured === true;
  const existing = new Set(repos.map((r) => r.full_name.toLowerCase()));

  const connect = async (full_name: string, br?: string) => {
    setBusy(full_name); setError(null);
    try {
      upsertRepo(await api.connectRepo(br ? { full_name, branch: br } : { full_name }));
      onClose();
    } catch (e) { setError(errorMessage(e)); setBusy(null); }
  };

  const manualName = manual.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const manualValid = /^[\w.-]+\/[\w.-]+$/.test(manualName);

  return (
    <Modal title="Connect GitHub repository" onClose={onClose} wide>
      <div className="space-y-4">
        {list.loading && !list.data && <LoadingBlock label="Checking GitHub link…" />}
        {list.error != null && <ErrorBanner error={list.error} onRetry={list.reload} />}

        {list.data && !connected && (
          <div className="rounded-lg border border-line bg-panel-2 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium"><GithubMark className="h-4 w-4" />Your GitHub account is not linked</div>
            <p className="mt-1 text-muted">Link it to list and index private repositories. Public repositories work without linking, type their name below.</p>
            {oauth ? (
              <a href="/api/auth/github/connect" className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-xs font-medium text-[#0a0b10] hover:bg-brand/90">
                <GithubMark className="h-3.5 w-3.5" />Link GitHub
              </a>
            ) : (
              <p className="mt-2 text-[11px] text-warn">GitHub sign-in is not configured on this server, so only public repositories can be connected.</p>
            )}
          </div>
        )}

        {connected && (
          <div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your repositories" aria-label="Search your repositories" className={`${inputCls} pl-9`} />
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {list.loading && <div className="flex justify-center py-3"><Spinner /></div>}
              {!list.loading && list.data!.repos.length === 0 && <p className="py-4 text-center text-xs text-muted">No repositories match{dq ? ` “${dq}”` : ""}.</p>}
              {list.data!.repos.map((r) => {
                const already = existing.has(r.full_name.toLowerCase());
                return (
                  <button key={r.full_name} disabled={already || busy !== null} onClick={() => void connect(r.full_name, r.default_branch)}
                    className="flex w-full items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-left enabled:hover:border-brand disabled:opacity-60">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-mono text-xs">{r.full_name}{r.private && <Lock className="h-3 w-3 text-muted" />}</div>
                      {r.description && <div className="truncate text-[11px] text-muted">{r.description}</div>}
                      <div className="text-[10px] text-muted/80">default branch {r.default_branch} · updated {timeAgo(r.updated_at)}</div>
                    </div>
                    {already ? <Badge tone="ok">connected</Badge> : busy === r.full_name ? <Spinner /> : <span className="text-[11px] text-brand">Connect</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); if (manualValid) void connect(manualName, branch.trim() || undefined); }} className="space-y-2 border-t border-line pt-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{connected ? "Or enter owner/name" : "Public repository"}</div>
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
            <Field label="owner/name"><input className={inputCls} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="vercel/next.js" spellCheck={false} /></Field>
            <Field label="Branch"><input className={inputCls} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="default" spellCheck={false} /></Field>
          </div>
          {manual.trim() && !manualValid && <p className="text-[11px] text-warn">Use the form owner/name, for example vercel/next.js.</p>}
          {existing.has(manualName.toLowerCase()) && <p className="text-[11px] text-warn">This repository is already connected.</p>}
          <Button type="submit" disabled={!manualValid || busy !== null || existing.has(manualName.toLowerCase())}>
            {busy === manualName && <Spinner className="h-3.5 w-3.5 text-[#0a0b10]" />}Connect repository
          </Button>
        </form>

        {error && <ErrorBanner error={error} />}
        <InfoBanner tone="info">Connecting indexes the repository on the server so agents can read it. Indexing runs in the background and progress shows on the repository card.</InfoBanner>
      </div>
    </Modal>
  );
}
