"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "@/components/AppState";
import { cn } from "@/components/ui";
import { highlightLine, langOf, TOKEN_CLASS } from "@/lib/highlight";
import { entryForPath } from "@/lib/why";
import type { Selection } from "@/lib/types";
import { Sparkles, MessageSquarePlus } from "lucide-react";

interface Pop { x: number; y: number; sel: Selection }

export function CodeEditor({ path }: { path: string }) {
  const { workspace, ask, setPendingSelection, activeRange } = useApp();
  const content = workspace?.files[path] ?? "";
  const lines = useMemo(() => content.split("\n"), [content]);
  const lang = langOf(path);
  const entry = workspace?.demo ? entryForPath(path) : undefined;
  const lensIdx = entry ? lines.findIndex((l) => l.includes(entry.lensKeyword)) : -1;
  const [pop, setPop] = useState<Pop | null>(null);
  const [mounted, setMounted] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { setPop(null); }, [path]);

  const onMouseUp = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) { setPop(null); return; }
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
    setPop({ x: Math.max(12, Math.min(rect.left, window.innerWidth - 360)), y, sel: { path, startLine: Math.min(a, b), endLine: Math.max(a, b), text } });
  };

  const fire = (sel: Selection, question: string) => {
    ask(question, sel);
    window.getSelection()?.removeAllRanges();
    setPop(null);
  };

  const inRange = (n: number) => !!activeRange && activeRange.path === path && n >= activeRange.startLine && n <= activeRange.endLine;

  return (
    <div className="relative h-full">
      <div ref={scroller} className="h-full overflow-auto bg-bg/40 py-2 font-mono text-[12.5px] leading-[1.65]" onMouseDown={() => setPop(null)} onMouseUp={onMouseUp} onScroll={() => setPop(null)}>
        <div className="min-w-max">
          {lines.map((l, i) => {
            const n = i + 1;
            return (
              <div key={i}>
                {i === lensIdx && entry && (
                  <button
                    onClick={() => fire({ path, startLine: n, endLine: n, text: l.trim() }, "Why does this exist?")}
                    className="ml-14 flex items-center gap-1.5 py-0.5 text-[11px] text-brand/80 hover:text-brand"
                  >
                    <Sparkles className="h-3 w-3" />ArchMind · {entry.lensLabel} · Why does this exist?
                  </button>
                )}
                <div data-line={n} className={cn("flex", inRange(n) && "bg-warn/10 shadow-[inset_2px_0_0_#fbbf24]")}>
                  <span className="w-12 shrink-0 select-none pr-4 text-right text-muted/45">{n}</span>
                  <span className="whitespace-pre pr-8">
                    {l === "" ? " " : highlightLine(l, lang).map((t, j) => <span key={j} className={TOKEN_CLASS[t.c]}>{t.t}</span>)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {mounted && pop && createPortal(
        <div className="fixed z-50 flex items-center gap-1 rounded-lg border border-brand/40 bg-panel-2 p-1 shadow-2xl" style={{ left: pop.x, top: pop.y }}>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => fire(pop.sel, "Why does this exist?")} className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-[#0a0b10] hover:bg-brand/90">
            <Sparkles className="h-3.5 w-3.5" />Why does this exist?
          </button>
          <button onMouseDown={(e) => e.preventDefault()} onClick={() => { setPendingSelection(pop.sel); window.getSelection()?.removeAllRanges(); setPop(null); }} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted hover:bg-line/60 hover:text-fg">
            <MessageSquarePlus className="h-3.5 w-3.5" />Add to chat
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
