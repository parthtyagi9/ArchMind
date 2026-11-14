"use client";
import { useState } from "react";
import { cn } from "@/components/ui";
import { EDGES, NODES } from "@/lib/mock";
import type { ArchNode, EdgeKind, NodeKind } from "@/lib/types";

const SIZE: Record<NodeKind, { w: number; h: number }> = {
  service: { w: 156, h: 54 },
  module: { w: 140, h: 44 },
  datastore: { w: 156, h: 54 },
  external: { w: 150, h: 48 },
};

export const KIND_COLOR: Record<NodeKind, string> = {
  service: "#7c8cff",
  module: "#38bdf8",
  datastore: "#34d399",
  external: "#8a90a8",
};

const EDGE_COLOR: Record<EdgeKind, string> = {
  imports: "#38bdf8",
  calls: "#7c8cff",
  reads: "#34d399",
  writes: "#34d399",
  proposed: "#fbbf24",
};

const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));

// Clip a center-to-center line at the node rectangles so arrowheads touch the border.
function endpoints(a: ArchNode, b: ArchNode) {
  const dx = b.x - a.x, dy = b.y - a.y;
  // Fraction of the center-to-center vector at which it leaves each rectangle (+ small gap).
  const frac = (n: ArchNode) => {
    const { w, h } = SIZE[n.kind];
    return Math.min(w / 2 / Math.max(Math.abs(dx), 1e-6), h / 2 / Math.max(Math.abs(dy), 1e-6)) + 0.01;
  };
  const fa = frac(a), fb = frac(b);
  return { x1: a.x + dx * fa, y1: a.y + dy * fa, x2: b.x - dx * fb, y2: b.y - dy * fb };
}

interface Props {
  selected: string | null;
  highlight: string[];
  onSelect: (id: string) => void;
}

export function ArchGraph({ selected, highlight, onSelect }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? selected;
  const connected = new Set<string>();
  if (focus) {
    connected.add(focus);
    EDGES.forEach((e) => { if (e.from === focus) connected.add(e.to); if (e.to === focus) connected.add(e.from); });
  }
  const dim = (id: string) => (focus && !connected.has(id) && !highlight.includes(id) ? 0.28 : 1);

  return (
    <svg viewBox="0 0 900 570" className="h-full w-full select-none">
      <defs>
        {(Object.keys(EDGE_COLOR) as EdgeKind[]).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={EDGE_COLOR[k]} />
          </marker>
        ))}
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M30 0H0V30" fill="none" stroke="#1b1f2d" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="900" height="570" fill="url(#grid)" />

      {EDGES.map((e, i) => {
        const a = byId[e.from], b = byId[e.to];
        const p = endpoints(a, b);
        const active = !!focus && (e.from === focus || e.to === focus);
        const lit = highlight.includes(e.from) && highlight.includes(e.to);
        return (
          <line
            key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2}
            stroke={EDGE_COLOR[e.kind]} strokeWidth={active || lit ? 2.2 : 1.3}
            strokeDasharray={e.kind === "proposed" ? "5 5" : e.kind === "imports" ? "2 4" : undefined}
            opacity={focus && !active && !lit ? 0.18 : 0.85} markerEnd={`url(#arrow-${e.kind})`}
            className={cn(lit && "flow")}
          />
        );
      })}

      {NODES.map((n) => {
        const { w, h } = SIZE[n.kind];
        const color = KIND_COLOR[n.kind];
        const isSel = selected === n.id;
        const isHi = highlight.includes(n.id);
        return (
          <g key={n.id} transform={`translate(${n.x - w / 2} ${n.y - h / 2})`} opacity={dim(n.id)} className="cursor-pointer transition-opacity"
            onClick={() => onSelect(n.id)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
            {isHi && <rect width={w} height={h} rx={12} fill="none" stroke="#fbbf24" strokeWidth={2} className="pulse-ring" />}
            <rect
              width={w} height={h} rx={n.kind === "module" ? 8 : 12}
              fill={isSel ? `${color}30` : "#12141d"} stroke={isSel || isHi ? (isHi ? "#fbbf24" : color) : `${color}88`}
              strokeWidth={isSel || isHi ? 2 : 1.2} strokeDasharray={n.ghost || n.kind === "external" ? "6 4" : undefined}
            />
            <rect x={0} y={0} width={4} height={h} rx={2} fill={color} opacity={n.ghost ? 0.4 : 1} />
            <text x={16} y={h / 2 - (n.kind === "module" ? 0 : 4)} fill="#e8eaf2" fontSize={12.5} fontWeight={600} dominantBaseline="middle">{n.label}</text>
            {n.kind !== "module" && (
              <text x={16} y={h / 2 + 12} fill="#8a90a8" fontSize={10} dominantBaseline="middle">
                {n.kind === "datastore" ? "datastore" : n.kind === "external" ? "external" : `${n.files.length} files`}
                {n.memoryIds.length > 0 ? ` · ${n.memoryIds.length} memories` : ""}
              </text>
            )}
            {n.kind === "module" && n.memoryIds.length > 0 && (
              <text x={w - 10} y={h / 2} fill="#7c8cff" fontSize={10} textAnchor="end" dominantBaseline="middle">◆ {n.memoryIds.length}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
