"use client";
import { Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layoutGraph, layoutGroups, type LaidEdge } from "@/lib/graphLayout";
import type { EdgeKind, Graph, GraphNode } from "@/lib/types";

export const KIND_COLOR: Record<GraphNode["kind"], string> = {
  service: "#4fb3ff",
  package: "#38bdf8",
  module: "#a78bfa",
  datastore: "#34d399",
  config: "#8a90a8",
};

export const EDGE_STYLE: Record<EdgeKind, { color: string; dash?: string; label: string }> = {
  imports: { color: "#5b6385", label: "imports" },
  calls_api: { color: "#2dd4bf", dash: "8 4", label: "calls API" },
  depends_on_package: { color: "#f472b6", dash: "2 4", label: "uses package" },
};

function edgeTitle(e: LaidEdge, from?: string, to?: string): string {
  const s = e.source;
  if (e.kind === "calls_api") {
    const eps = (s.endpoints ?? []).slice(0, 8).map((x) => `${x.method} ${x.path}`).join("\n  ");
    return `${from} calls ${to} over HTTP (${e.weight} call site${e.weight === 1 ? "" : "s"})\n  ${eps}${(s.endpoints?.length ?? 0) > 8 ? `\n  … ${s.endpoints!.length - 8} more` : ""}`;
  }
  if (e.kind === "depends_on_package") return `${from} uses package ${(s.packages ?? []).join(", ")} published by ${to}`;
  return `${from} imports ${to} (${e.weight} import${e.weight === 1 ? "" : "s"})${e.cyclic ? " · part of a cycle" : ""}`;
}

interface View { k: number; x: number; y: number }
const MIN_K = 0.15;
const MAX_K = 3;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  graph: Graph;
  selected: string | null;
  highlight: string[];
  onSelect: (id: string) => void;
  /** Group map: nodes carry repo_id and are drawn inside one box per repository. */
  grouped?: boolean;
}

export function ArchGraph({ graph, selected, highlight, onSelect, grouped }: Props) {
  const layout = useMemo(() => (grouped ? layoutGroups(graph.nodes, graph.edges) : layoutGraph(graph.nodes, graph.edges)), [graph, grouped]);
  const kinds = useMemo(() => new Set(layout.edges.map((e) => e.kind)), [layout]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const maxWeight = useMemo(() => Math.max(1, ...layout.edges.map((e) => e.weight)), [layout]);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (!width || !height) return;
    const k = clamp(Math.min(width / layout.width, height / layout.height, 1.2), MIN_K, MAX_K);
    setView({ k, x: (width - layout.width * k) / 2, y: (height - layout.height * k) / 2 });
  }, [layout]);

  useEffect(() => { fit(); }, [fit]);

  // non-passive wheel listener so the page does not scroll while zooming
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      setView((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0015), MIN_K, MAX_K);
        const f = k / v.k;
        return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (f: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = r.width / 2, py = r.height / 2;
    setView((v) => { const k = clamp(v.k * f, MIN_K, MAX_K); const g = k / v.k; return { k, x: px - (px - v.x) * g, y: py - (py - v.y) * g }; });
  };

  const focus = hover ?? selected;
  const connected = useMemo(() => {
    const s = new Set<string>();
    if (focus) { s.add(focus); for (const e of layout.edges) { if (e.from === focus) s.add(e.to); if (e.to === focus) s.add(e.from); } }
    return s;
  }, [focus, layout]);
  const hi = useMemo(() => new Set(highlight), [highlight]);
  const dim = (id: string) => (focus && !connected.has(id) && !hi.has(id) ? 0.3 : 1);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <svg
        ref={svgRef} className={`h-full w-full touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`} role="img" aria-label="Architecture dependency graph"
        onPointerDown={(e) => { if ((e.target as Element).closest("[data-node]")) return; drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy })); }}
        onPointerUp={() => { drag.current = null; setDragging(false); }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}
      >
        <defs>
          <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5b6385" /></marker>
          <marker id="arch-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4fb3ff" /></marker>
          {(["calls_api", "depends_on_package"] as const).map((k) => (
            <marker key={k} id={`arch-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={EDGE_STYLE[k].color} /></marker>
          ))}
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.clusters.map((c) => (
            <g key={c.id} pointerEvents="none">
              <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={16} fill="#4fb3ff08" stroke="#4fb3ff40" strokeDasharray="4 4" />
              <text x={c.x + 14} y={c.y + 18} fill="#a7b0ff" fontSize={12} fontWeight={600} fontFamily="ui-monospace, monospace">{c.label}</text>
            </g>
          ))}
          {layout.edges.map((e, i) => {
            const a = layout.nodes.get(e.from), b = layout.nodes.get(e.to);
            if (!a || !b) return null;
            const forward = e.crossRepo ? b.x >= a.x : !e.cyclic;
            const x1 = forward ? a.x + a.w : a.x, y1 = a.y + a.h / 2;
            const x2 = forward ? b.x : b.x + b.w, y2 = b.y + b.h / 2;
            const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
            const on = !!focus && (e.from === focus || e.to === focus);
            const lit = hi.has(e.from) && hi.has(e.to);
            const width = (1 + 3 * Math.sqrt(e.weight / maxWeight)) * (on || lit ? 1.3 : 1);
            const st = EDGE_STYLE[e.kind];
            const plain = e.kind === "imports";
            const label = (n?: GraphNode) => (n ? (grouped && n.repo_name ? `${n.repo_name} · ${n.label}` : n.label) : "?");
            return (
              <path key={i} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} fill="none"
                stroke={plain ? (on || lit ? "#4fb3ff" : st.color) : st.color} strokeWidth={plain ? width : Math.max(1.6, width)}
                strokeDasharray={plain ? (e.cyclic ? "6 5" : undefined) : st.dash}
                opacity={focus && !on && !lit ? 0.15 : plain ? 0.8 : 0.95} markerEnd={`url(#arch-arrow${plain ? (on || lit ? "-on" : "") : `-${e.kind}`})`}>
                <title>{edgeTitle(e, label(nodeById.get(e.from)), label(nodeById.get(e.to)))}</title>
              </path>
            );
          })}

          {graph.nodes.map((n) => {
            const p = layout.nodes.get(n.id);
            if (!p) return null;
            const color = KIND_COLOR[n.kind];
            const isSel = selected === n.id;
            const isHi = hi.has(n.id);
            return (
              <g key={n.id} data-node transform={`translate(${p.x} ${p.y})`} opacity={dim(n.id)} className="cursor-pointer transition-opacity" tabIndex={0} role="button" aria-label={`${n.label}, ${n.kind}`}
                onClick={() => onSelect(n.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(n.id); } }}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}>
                {isHi && <rect width={p.w} height={p.h} rx={12} fill="none" stroke="#fbbf24" strokeWidth={2} className="pulse-ring" />}
                <rect width={p.w} height={p.h} rx={n.kind === "module" ? 8 : 12} fill={isSel ? `${color}30` : "#12141d"} stroke={isHi ? "#fbbf24" : isSel ? color : `${color}88`} strokeWidth={isSel || isHi ? 2 : 1.2} strokeDasharray={n.kind === "config" ? "6 4" : undefined} />
                <rect x={0} y={0} width={4} height={p.h} rx={2} fill={color} />
                <text x={16} y={p.h / 2 - 5} fill="#e8eaf2" fontSize={12.5} fontWeight={600} dominantBaseline="middle">{n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}</text>
                <text x={16} y={p.h / 2 + 11} fill="#8a90a8" fontSize={10} dominantBaseline="middle">{n.kind} · {n.file_count} file{n.file_count === 1 ? "" : "s"}{n.loc > 0 ? ` · ${n.loc.toLocaleString()} loc` : ""}</text>
                {n.memory_count > 0 && (
                  <g transform={`translate(${p.w - 4} 4)`}>
                    <rect x={-40} y={-2} width={44} height={16} rx={8} fill="#4fb3ff" />
                    <text x={-18} y={6.5} fill="#0a0b10" fontSize={10} fontWeight={700} textAnchor="middle" dominantBaseline="middle">◆ {n.memory_count}</text>
                  </g>
                )}
                <title>{`${n.label} (${n.path})`}</title>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-lg border border-line bg-panel/90 p-1">
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in" className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line/60 hover:text-fg"><Plus className="h-3.5 w-3.5" /></button>
        <button onClick={() => zoomBy(0.8)} aria-label="Zoom out" className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line/60 hover:text-fg"><Minus className="h-3.5 w-3.5" /></button>
        <button onClick={fit} aria-label="Fit to view" className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line/60 hover:text-fg"><Maximize className="h-3.5 w-3.5" /></button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line bg-panel/90 px-2.5 py-1.5 text-[11px] text-muted">
        {(Object.keys(KIND_COLOR) as GraphNode["kind"][]).map((k) => <span key={k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: KIND_COLOR[k] }} />{k}</span>)}
        {(["calls_api", "depends_on_package"] as const).filter((k) => kinds.has(k)).map((k) => (
          <span key={k} className="flex items-center gap-1"><svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke={EDGE_STYLE[k].color} strokeWidth="2" strokeDasharray={EDGE_STYLE[k].dash} /></svg>{EDGE_STYLE[k].label}</span>
        ))}
        <span>arrow: imports · dashed grey: cycle · ◆ governing memories</span>
      </div>
    </div>
  );
}
