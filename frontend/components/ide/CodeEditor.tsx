"use client";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "@/components/AppState";
import { Button, ErrorBanner, Skeleton, cn } from "@/components/ui";
import { highlightLine, langOf, TOKEN_CLASS } from "@/lib/highlight";
import { splitGroupPath } from "@/lib/groupData";
import { useRepoFile } from "@/lib/repoData";
import type { Repo, Selection } from "@/lib/types";

interface Pop { x: number; y: number; sel: Selection }

const CHUNK = 3000;

export function CodeEditor({ path }: { path: string }) {
  const { workspace, repo, groupMembers } = useApp();
  if (workspace?.kind === "group") {
    const hit = splitGroupPath(groupMembers, path);
    if (!hit) return <div className="p-4 text-xs text-muted">This file belongs to a repository that is no longer part of the group.</div>;
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-line bg-panel/60 px-3 py-1 font-mono text-[12px] text-muted">{hit.repo.full_name} · {hit.repo.branch}</div>
        <div className="min-h-0 flex-1"><RepoFileView repo={hit.repo} path={hit.path} viewPath={path} /></div>
      </div>
    );
  }
  if (workspace?.kind === "local") {
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-line bg-info-soft px-3 py-1 text-[12px] text-info">Local file: GitHub provenance unavailable. The GitHub agent will be skipped; Jira, Confluence and Memory still run.</div>
        <div className="min-h-0 flex-1"><CodeView path={path} content={workspace.files[path] ?? ""} /></div>
      </div>
    );
  }
  if (!repo) return null;
  return <RepoFileView repo={repo} path={path} />;
}

/** `viewPath` is the path the tab and selections use (it carries the repository prefix in a group workspace). */
function RepoFileView({ repo, path, viewPath }: { repo: Repo; path: string; viewPath?: string }) {
  const file = useRepoFile(repo, path);
  if (repo.status !== "ready") return <div className="p-4 text-xs text-muted">Files are available once indexing has finished.</div>;
  if (file.error != null) return <div className="p-4"><ErrorBanner error={file.error} onRetry={file.reload} /></div>;
  if (file.loading || !file.data) {
    return <div className="space-y-2 p-4">{[70, 45, 80, 60, 35, 75, 50].map((w, i) => <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />)}</div>;
  }
  return <CodeView path={viewPath ?? path} content={file.data.content} />;
}

function CodeView({ path, content }: { path: string; content: string }) {
  const { requestAsk, setPendingSelection, activeRange, can } = useApp();
  const lines = useMemo(() => content.split("\n"), [content]);
  const [shown, setShown] = useState(CHUNK);
  const lang = langOf(path);
  const [pop, setPop] = useState<Pop | null>(null);
  const [mounted, setMounted] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const canAsk = can("ask");

  useEffect(() => setMounted(true), []);

  const onMouseUp = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0 || !scroller.current?.contains(s.anchorNode)) { setPop(null); return; }
    const text = s.toString();
    if (!text.trim()) { setPop(null); return; }
    const lineOf = (n: Node | null) => {
      const el = (n instanceof Element ? n : n?.parentElement)?.closest("[data-line]");
      return el ? Number(el.getAttribute("data-line")) : null;
    };
    const a = lineOf(s.anchorNode), b = lineOf(s.focusNode);
    if (a == null || b == null) { setPop(null); return; }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const y = rect.top > 56 ? rect.top - 42 : rect.bottom + 8;
    setPop({ x: Math.max(12, Math.min(rect.left, window.innerWidth - 360)), y, sel: { path, start_line: Math.min(a, b), end_line: Math.max(a, b), text } });
  };

  const fire = (sel: Selection) => {
    requestAsk("Why does this exist?", sel);
    window.getSelection()?.removeAllRanges();
    setPop(null);
  };

  const inRange = (n: number) => !!activeRange && activeRange.path === path && n >= activeRange.start_line && n <= activeRange.end_line;

  return (
    <div className="relative h-full">
      <div ref={scroller} className="h-full overflow-auto bg-bg/40 py-2 font-mono text-[13.5px] leading-[1.65]" onMouseDown={() => setPop(null)} onMouseUp={onMouseUp} onScroll={() => setPop(null)}>
        <div className="min-w-max">
          {lines.slice(0, shown).map((l, i) => {
            const n = i + 1;
            return (
              <div key={i} data-line={n} className={cn("flex", inRange(n) && "bg-warn/10 shadow-[inset_2px_0_0_#fbbf24]")}>
                <span className="w-12 shrink-0 select-none pr-4 text-right text-muted/45">{n}</span>
                <span className="whitespace-pre pr-8">
                  {l === "" ? " " : highlightLine(l, lang).map((t, j) => <span key={j} className={TOKEN_CLASS[t.c]}>{t.t}</span>)}
                </span>
              </div>
            );
          })}
          {lines.length > shown && (
            <div className="px-12 py-3 font-sans">
              <Button size="sm" variant="outline" onClick={() => setShown((s) => s + CHUNK)}>Show {Math.min(CHUNK, lines.length - shown)} more lines ({lines.length - shown} hidden)</Button>
            </div>
          )}
        </div>
      </div>

      {mounted && pop && createPortal(
        <div className="fixed z-50 flex items-center gap-1 rounded-lg border border-brand/40 bg-panel-2 p-1 shadow-2xl" style={{ left: pop.x, top: pop.y }}>
          <button onMouseDown={(e) => e.preventDefault()} disabled={!canAsk} title={canAsk ? undefined : "Your role cannot ask questions (needs the ask permission)"}
            onClick={() => fire(pop.sel)} className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-[#0a0b10] hover:bg-brand/90 disabled:opacity-50">
            <Sparkles className="h-3.5 w-3.5" />Why does this exist?
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setPendingSelection(pop.sel); window.getSelection()?.removeAllRanges(); setPop(null); }}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted hover:bg-line/60 hover:text-fg">
            <MessageSquarePlus className="h-3.5 w-3.5" />Add to chat
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
