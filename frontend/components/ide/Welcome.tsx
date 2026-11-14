"use client";
import { Check, FileText, FolderOpen, Layers, Lock, X } from "lucide-react";
import { useRef, useState } from "react";
import { useApp } from "@/components/AppState";
import { Button, cn } from "@/components/ui";
import { DEMO_FILES } from "@/lib/files";
import { highlightLine, TOKEN_CLASS } from "@/lib/highlight";
import { readFolder, readSingleFile } from "@/lib/localFiles";
import { REPO } from "@/lib/mock";

const PREVIEW = `export function validate(token: string): Claims {
  try {
    const claims = jwt.verify(token, config.auth.publicKey, {
      algorithms: ["RS256"],
      audience: EXPECTED_AUD,
      clockTolerance: 5,
    }) as Claims;
    return claims;
  } catch (err) {
    throw new TokenError("invalid_token", err);
  }
}`.split("\n");

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function Welcome() {
  const { openWorkspace } = useApp();
  const folderRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [gh, setGh] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openDemo = () => openWorkspace({ name: REPO.name, source: "github", demo: true, files: DEMO_FILES });

  const onFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const r = await readFolder(e.target.files);
    if (!Object.keys(r.files).length) { setErr("No readable source files in that folder."); return; }
    setErr(null);
    openWorkspace({ name: r.name, source: "local", demo: false, files: r.files });
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = await readSingleFile(f);
    setErr(null);
    openWorkspace({ name: r.name, source: "local", demo: false, files: r.files });
  };

  return (
    <div className="relative grid h-screen place-items-center overflow-hidden px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_400px_at_50%_30%,#7c8cff1a,transparent_70%)]" />
      <div className="relative w-full max-w-4xl">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand to-info"><Layers className="h-5 w-5 text-[#0a0b10]" /></div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">ArchMind</h1>
            <p className="text-xs text-muted">Select any code and ask why it exists. Sub-agents search GitHub, Jira and Confluence for the answer.</p>
          </div>
        </div>

        {/* Faux IDE window */}
        <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-[0_30px_80px_-20px_#000]">
          <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-2">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" />
            <span className="ml-3 rounded-md bg-bg px-3 py-0.5 font-mono text-[11px] text-muted">validate.ts</span>
            <span className="ml-auto text-[11px] text-muted">acme/payments-platform</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_260px]">
            <div className="relative overflow-hidden bg-bg/60 p-4 font-mono text-[12px] leading-[1.7]">
              {PREVIEW.map((l, i) => (
                <div key={i} className={cn("flex", i >= 2 && i <= 6 && "bg-brand/15")}>
                  <span className="w-7 shrink-0 select-none pr-3 text-right text-muted/40">{i + 14}</span>
                  <span className="whitespace-pre">{highlightLine(l, "ts").map((t, j) => <span key={j} className={TOKEN_CLASS[t.c]}>{t.t}</span>)}</span>
                </div>
              ))}
              <div className="absolute left-24 top-[34px] rounded-md border border-brand/40 bg-panel-2 px-2.5 py-1 font-sans text-[11px] text-brand shadow-lg">✦ Why does this exist?</div>
            </div>
            <div className="space-y-2 border-l border-line bg-panel p-3 text-[11px]">
              <div className="font-medium text-fg">ArchMind agents</div>
              {[["GitHub", "PR #377 · a41c9e2"], ["Jira", "AUTH-311"], ["Confluence", "Authentication architecture"], ["Memory", "2 approved decisions"]].map(([n, d]) => (
                <div key={n} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
                  <Check className="h-3 w-3 text-ok" /><span className="text-fg">{n}</span><span className="ml-auto truncate text-muted">{d}</span>
                </div>
              ))}
              <p className="pt-1 leading-relaxed text-muted">Added after AUTH-311, where a token for another service was accepted…</p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <button onClick={() => setGh(true)} className="group rounded-xl border border-line bg-panel/80 p-4 text-left transition-colors hover:border-brand">
            <GithubMark className="h-5 w-5 text-fg" />
            <div className="mt-3 text-sm font-medium">Connect GitHub</div>
            <div className="text-xs text-muted">Open a repository you have access to</div>
          </button>
          <button onClick={() => folderRef.current?.click()} className="rounded-xl border border-line bg-panel/80 p-4 text-left transition-colors hover:border-brand">
            <FolderOpen className="h-5 w-5 text-brand" />
            <div className="mt-3 text-sm font-medium">Open folder</div>
            <div className="text-xs text-muted">Read a project from your computer</div>
          </button>
          <button onClick={() => fileRef.current?.click()} className="rounded-xl border border-line bg-panel/80 p-4 text-left transition-colors hover:border-brand">
            <FileText className="h-5 w-5 text-info" />
            <div className="mt-3 text-sm font-medium">Open file</div>
            <div className="text-xs text-muted">Inspect a single file</div>
          </button>
        </div>
        {err && <p className="mt-3 text-center text-xs text-bad">{err}</p>}
        <p className="mt-4 text-center text-xs text-muted">
          No repository handy? <button onClick={openDemo} className="text-brand hover:underline">Open the demo repository</button>
          <span className="mx-2">·</span>files are read in your browser and never uploaded.
        </p>

        <input ref={folderRef} type="file" className="hidden" onChange={onFolder} {...({ webkitdirectory: "", directory: "" } as object)} />
        <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
      </div>

      {gh && <GithubModal onClose={() => setGh(false)} onPick={() => { setGh(false); openDemo(); }} />}
    </div>
  );
}

const REPOS = [
  { name: "acme/payments-platform", desc: "Payments monorepo · TypeScript", ready: true },
  { name: "acme/web-app", desc: "Customer web application", ready: false },
  { name: "acme/infra", desc: "Terraform and deploy configs", ready: false },
];

function GithubModal({ onClose, onPick }: { onClose: () => void; onPick: () => void }) {
  const [authed, setAuthed] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <GithubMark className="h-5 w-5" /><h3 className="text-sm font-semibold">Connect GitHub</h3>
          <button onClick={onClose} className="ml-auto text-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 rounded-md bg-warn-soft px-2.5 py-1.5 text-[11px] text-warn">Preview: GitHub sign-in is simulated. Only the demo repository has data.</p>
        {!authed ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">ArchMind requests read access to repository contents, pull requests and issues.</p>
            <Button className="w-full" onClick={() => setAuthed(true)}><GithubMark className="h-4 w-4" />Authorize ArchMind</Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {REPOS.map((r) => (
              <button key={r.name} disabled={!r.ready} onClick={onPick} className="flex w-full items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-left enabled:hover:border-brand disabled:opacity-50">
                <div className="min-w-0 flex-1"><div className="font-mono text-xs">{r.name}</div><div className="text-[11px] text-muted">{r.desc}</div></div>
                {r.ready ? <span className="text-[11px] text-ok">open</span> : <span className="flex items-center gap-1 text-[11px] text-muted"><Lock className="h-3 w-3" />not indexed</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
