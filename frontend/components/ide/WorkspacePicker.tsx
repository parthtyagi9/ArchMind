"use client";
import { ArrowLeft, FileText, FolderOpen, Layers, Plus, Settings } from "lucide-react";
import { useRef, useState } from "react";
import { useApp } from "@/components/AppState";
import { ConnectRepoModal } from "@/components/ide/ConnectRepoModal";
import { RepoCard } from "@/components/ide/RepoCard";
import { UserMenu } from "@/components/ide/UserMenu";
import { SettingsView } from "@/components/settings/SettingsView";
import { Button, ErrorBanner, GithubMark, InfoBanner, Skeleton } from "@/components/ui";
import { readFolder, readSingleFile } from "@/lib/localFiles";

export function WorkspacePicker() {
  const { me, repos, reposLoading, reposError, refreshRepos, can, openLocal, notice, setNotice, settingsOpen, setSettingsOpen, integrations } = useApp();
  const folderRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [connect, setConnect] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const onFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;
    try {
      const r = await readFolder(list);
      if (!Object.keys(r.files).length) setLocalError("No readable source files in that folder.");
      else { setLocalError(null); openLocal(r.name, r.files); }
    } catch { setLocalError("Could not read that folder."); }
    e.target.value = "";
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const r = await readSingleFile(f); setLocalError(null); openLocal(r.name, r.files); }
    catch { setLocalError("Could not read that file."); }
    e.target.value = "";
  };

  const header = (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel/80 px-4">
      <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand to-info"><Layers className="h-4 w-4 text-[#0a0b10]" /></div>
      <span className="text-sm font-semibold">ArchMind</span>
      <span className="text-xs text-muted">{me.org.name}</span>
      <div className="ml-auto flex items-center gap-2">
        <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-line/50 hover:text-fg"><Settings className="h-3.5 w-3.5" />Settings</button>
        <UserMenu popover="below" />
      </div>
    </header>
  );

  if (settingsOpen) {
    return (
      <div className="flex h-screen flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <button onClick={() => setSettingsOpen(false)} className="mb-3 flex items-center gap-1.5 text-xs text-muted hover:text-fg"><ArrowLeft className="h-3.5 w-3.5" />Back to workspaces</button>
          <SettingsView />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {header}
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight">Open a workspace</h1>
            <p className="mt-1 text-xs text-muted">Select any code and ask why it exists. Sub-agents search GitHub, Jira, Confluence and your organization&apos;s governed memory for the answer.</p>
          </div>

          {notice && (
            <InfoBanner tone={notice.kind === "ok" ? "ok" : "warn"} className="mb-4 flex items-start gap-2">
              <span className="flex-1">{notice.text}</span>
              <button onClick={() => setNotice(null)} className="text-[11px] underline">Dismiss</button>
            </InfoBanner>
          )}

          <section aria-labelledby="repos-h">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 id="repos-h" className="text-sm font-semibold">Connected repositories</h2>
              <span className="text-xs text-muted">{repos.length > 0 && `${repos.length} in ${me.org.name}`}</span>
              <Button size="sm" className="ml-auto" disabled={!can("connect_repo")} onClick={() => setConnect(true)}
                title={can("connect_repo") ? undefined : "Requires the connect_repo permission (admin or owner)"}>
                <Plus className="h-3.5 w-3.5" />Connect GitHub repository
              </Button>
            </div>
            {!can("connect_repo") && <p className="mb-3 text-[11px] text-muted">Your role ({me.org.role}) cannot connect repositories. Ask an admin or owner to connect one.</p>}

            {reposError && <ErrorBanner error={reposError} onRetry={() => void refreshRepos()} className="mb-3" />}
            {reposLoading && repos.length === 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
            ) : repos.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{repos.map((r) => <RepoCard key={r.id} repo={r} />)}</div>
            ) : !reposError && (
              <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
                <GithubMark className="h-6 w-6 text-muted" />
                <p className="mt-3 text-sm font-medium">No repositories connected yet</p>
                <p className="mt-1 max-w-sm text-xs text-muted">{can("connect_repo") ? "Connect a GitHub repository to index it, or open a local folder below." : "Ask an admin to connect a repository, or open a local folder below."}</p>
                {can("connect_repo") && <Button size="sm" className="mt-3" onClick={() => setConnect(true)}><Plus className="h-3.5 w-3.5" />Connect a repository</Button>}
              </div>
            )}
          </section>

          <section className="mt-8" aria-labelledby="local-h">
            <h2 id="local-h" className="mb-3 text-sm font-semibold">Local files</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <button onClick={() => folderRef.current?.click()} className="rounded-xl border border-line bg-panel/80 p-4 text-left transition-colors hover:border-brand">
                <FolderOpen className="h-5 w-5 text-brand" /><div className="mt-3 text-sm font-medium">Open local folder</div>
                <div className="text-xs text-muted">Read a project from your computer</div>
              </button>
              <button onClick={() => fileRef.current?.click()} className="rounded-xl border border-line bg-panel/80 p-4 text-left transition-colors hover:border-brand">
                <FileText className="h-5 w-5 text-info" /><div className="mt-3 text-sm font-medium">Open file</div>
                <div className="text-xs text-muted">Inspect a single file</div>
              </button>
            </div>
            {localError && <p role="alert" className="mt-2 text-xs text-bad">{localError}</p>}
            <p className="mt-2 text-[11px] leading-relaxed text-muted">Local files are read in your browser and never uploaded. A local workspace has no GitHub provenance: the GitHub agent reports itself skipped, while Jira, Confluence and Memory agents still run.</p>
          </section>

          {integrations && !integrations.github.connected && (
            <p className="mt-6 text-[11px] text-muted">Your GitHub account is not linked. Link it in Settings to connect private repositories.</p>
          )}
        </div>
      </main>
      <input ref={folderRef} type="file" className="hidden" onChange={(e) => void onFolder(e)} {...({ webkitdirectory: "", directory: "" } as object)} />
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => void onFile(e)} />
      {connect && <ConnectRepoModal onClose={() => setConnect(false)} />}
    </div>
  );
}
