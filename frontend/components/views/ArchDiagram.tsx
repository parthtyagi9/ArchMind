"use client";
import { Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nodeSubtitle, nodeTitle, type ArchLayout, type PlacedEdge, type PlacedNode } from "@/lib/archLayout";
import { useTheme, type Theme } from "@/lib/theme";
import type { ArchRole } from "@/lib/types";

/** Role colours, grouped by layer so a newcomer can read the stack: screens (blue) -> API (amber) -> logic (green) -> data (rose).
 *  Dark uses bright pastels on a dark canvas; light uses deeper, saturated tones so borders and text stay readable on white. */
const ROLE_COLORS: Record<Theme, Record<ArchRole, string>> = {
  dark: {
    actor: "#a78bfa", router: "#60a5fa", page: "#60a5fa", component: "#93c5fd", client: "#38bdf8", endpoint: "#fbbf24", job: "#f472b6",
    service: "#34d399", mapper: "#a3e635", repository: "#fb7185", entity: "#f87171", database: "#f87171", external: "#c084fc",
  },
  light: {
    actor: "#6d28d9", router: "#1d4ed8", page: "#2563eb", component: "#3b82f6", client: "#0369a1", endpoint: "#b45309", job: "#be185d",
    service: "#047857", mapper: "#4d7c0f", repository: "#be123c", entity: "#b91c1c", database: "#b91c1c", external: "#7e22ce",
  },
};
const ROLE_LABEL: Record<ArchRole, string> = {
  actor: "user", router: "app routes", page: "screen", component: "UI component", client: "API client", endpoint: "API endpoint", job: "scheduled job",
  service: "service", mapper: "mapper", repository: "repository", entity: "stored record", database: "database", external: "external system",
};
/** Dark palette, for callers that only need a static swatch; use roleColor() for theme-aware colour. */
export const ROLE_STYLE: Record<ArchRole, { color: string; label: string }> = Object.fromEntries(
  (Object.keys(ROLE_LABEL) as ArchRole[]).map((r) => [r, { color: ROLE_COLORS.dark[r], label: ROLE_LABEL[r] }]),
) as Record<ArchRole, { color: string; label: string }>;
export const roleColor = (role: ArchRole, theme: Theme) => ROLE_COLORS[theme][role] ?? ROLE_COLORS[theme].service;

/** Neutral colours of the canvas per theme. */
const INK: Record<Theme, {
  title: string; sub: string; groupTitle: string; groupSub: string; edge: string; edgeOn: string; http: string; httpText: string; external: string;
  labelBg: string; labelText: string; labelBorder: string; nodeFillAlpha: string; nodeFillSel: string; strokeAlpha: string; groupFill: string; groupStroke: string; lit: string;
}> = {
  dark: {
    title: "#eef0f8", sub: "#9aa1bd", groupTitle: "#d6dbf5", groupSub: "#8a90a8", edge: "#5f6788", edgeOn: "#a7b0ff", http: "#2dd4bf", httpText: "#5eead4",
    external: "#c084fc", labelBg: "#0c1422", labelText: "#aab0c8", labelBorder: "transparent", nodeFillAlpha: "14", nodeFillSel: "2e", strokeAlpha: "aa",
    groupFill: "0d", groupStroke: "55", lit: "#fbbf24",
  },
  light: {
    title: "#0f172a", sub: "#475569", groupTitle: "#0f172a", groupSub: "#475569", edge: "#64748b", edgeOn: "#4338ca", http: "#0f766e", httpText: "#0f766e",
    external: "#7e22ce", labelBg: "#ffffff", labelText: "#334155", labelBorder: "#cbd5e1", nodeFillAlpha: "1a", nodeFillSel: "33", strokeAlpha: "",
    groupFill: "0f", groupStroke: "80", lit: "#d97706",
  },
};
const GROUP_TINT: Record<Theme, { frontend: string; backend: string; external: string; data: string }> = {
  dark: { frontend: "#60a5fa", backend: "#8a90a8", external: "#c084fc", data: "#fb7185" },
  light: { frontend: "#2563eb", backend: "#64748b", external: "#7e22ce", data: "#be123c" },
};

interface View { k: number; x: number; y: number }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN_K = 0.1;
const MAX_K = 2.5;

interface Props {
  layout: ArchLayout;
  selected: string | null;
  highlight: Set<string>;
  showTags: boolean;
  onSelect: (id: string | null) => void;
  onOpenFeature?: (featureId: string) => void;
}

export function ArchDiagram({ layout, selected, highlight, showTags, onSelect, onOpenFeature }: Props) {
  const theme = useTheme();
  const ink = INK[theme];
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const anim = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  // ---- camera: programmatic moves animate (ease-out); a drag or the wheel cancels them
  const stopAnim = () => { if (anim.current !== null) { cancelAnimationFrame(anim.current); anim.current = null; } };
  const animateTo = useCallback((to: View, ms = 420) => {
    stopAnim();
    const from = viewRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      setView({ k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      anim.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  /** Fit a box (in diagram coordinates) into the viewport with a margin. */
  const frame = useCallback((x: number, y: number, w: number, h: number, maxK: number, animate = true) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    const k = clamp(Math.min((r.width * 0.86) / w, (r.height * 0.86) / h, maxK), MIN_K, MAX_K);
    const to = { k, x: r.width / 2 - (x + w / 2) * k, y: r.height / 2 - (y + h / 2) * k };
    if (animate) animateTo(to); else setView(to);
  }, [animateTo]);

  const fit = useCallback((animate = true) => frame(0, 0, layout.width, layout.height, 1.1, animate), [frame, layout]);
  useEffect(() => { fit(false); }, [fit]);

  /** Zoom into one box, keeping its direct neighbours partly in view for context. */
  const focusNode = useCallback((id: string) => {
    const p = layout.nodes.find((n) => n.id === id);
    if (!p) return;
    const near = new Set([id]);
    for (const e of layout.edges) { if (e.edge.from === id) near.add(e.edge.to); if (e.edge.to === id) near.add(e.edge.from); }
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    let x0 = p.x, y0 = p.y, x1 = p.x + p.w, y1 = p.y + p.h;
    for (const b of layout.nodes) {
      if (!near.has(b.id)) continue;
      // far neighbours only pull the frame halfway, so the zoom stays close
      x0 = Math.min(x0, cx + (b.x - cx) * 0.5); y0 = Math.min(y0, cy + (b.y - cy) * 0.5);
      x1 = Math.max(x1, cx + (b.x + b.w - cx) * 0.5); y1 = Math.max(y1, cy + (b.y + b.h - cy) * 0.5);
    }
    frame(x0, y0, Math.max(x1 - x0, p.w * 2.2), Math.max(y1 - y0, p.h * 4), 1.8);
  }, [layout, frame]);

  // zoom whenever the selection changes (also when picked from the side panel); wait a frame so the
  // details panel has taken its width before the viewport is measured
  useEffect(() => {
    if (!selected) return;
    const id = requestAnimationFrame(() => focusNode(selected));
    return () => cancelAnimationFrame(id);
  }, [selected, focusNode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest?.("input,textarea,select,[role=dialog]")) return;
      onSelect(null);
      fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit, onSelect]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnim();
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
  useEffect(() => () => stopAnim(), []);
  const zoomBy = (f: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const v = viewRef.current;
    const k = clamp(v.k * f, MIN_K, MAX_K), g = k / v.k;
    animateTo({ k, x: r.width / 2 - (r.width / 2 - v.x) * g, y: r.height / 2 - (r.height / 2 - v.y) * g }, 220);
  };

  const focus = hover ?? selected;
  const connected = useMemo(() => {
    const s = new Set<string>();
    if (!focus) return s;
    s.add(focus);
    for (const e of layout.edges) { if (e.edge.from === focus) s.add(e.edge.to); if (e.edge.to === focus) s.add(e.edge.from); }
    return s;
  }, [focus, layout]);
  const edgeOn = (e: PlacedEdge) => hoverEdge === e.id || (!!focus && (e.edge.from === focus || e.edge.to === focus));
  const nodeDim = (n: PlacedNode) => (n.faded ? 0.6 : 1) * (focus && !connected.has(n.id) && !highlight.has(n.id) ? (theme === "light" ? 0.35 : 0.3) : 1);

  return (
    <div className="absolute inset-0 overflow-hidden">
      <svg ref={svgRef} role="img" aria-label="Architecture map" className={`h-full w-full touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-node],[data-edge],[data-group]")) return;
          stopAnim();
          drag.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y };
          setDragging(true); e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy })); }}
        onPointerUp={() => { drag.current = null; setDragging(false); }} onPointerCancel={() => { drag.current = null; setDragging(false); }}
        onDoubleClick={(e) => { if (!(e.target as Element).closest("[data-node],[data-group]")) { onSelect(null); fit(); } }}>
        <defs>
          <marker id="am-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style={{ fill: ink.edge }} /></marker>
          <marker id="am-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style={{ fill: ink.edgeOn }} /></marker>
          <marker id="am-arrow-http" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style={{ fill: ink.http }} /></marker>
          <marker id="am-arrow-ext" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style={{ fill: ink.external }} /></marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.groups.map((g) => {
            const tints = GROUP_TINT[theme];
            const tint = g.feature.id.endsWith("data") ? tints.data : tints[g.feature.tier];
            return (
              <g key={g.id} data-group className="cursor-zoom-in" onClick={() => frame(g.x, g.y, g.w, g.h, 1.4)}>
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={14} style={{ fill: `${tint}${ink.groupFill}`, stroke: `${tint}${ink.groupStroke}` }}
                  strokeWidth={theme === "light" ? 1.3 : 1} strokeDasharray="5 4" />
                <text x={g.x + 14} y={g.y + 21} style={{ fill: theme === "light" ? tint : ink.groupTitle }} fontSize={12.5} fontWeight={700}>{g.feature.name}</text>
                {g.feature.repo_name && <text x={g.x + g.w - 12} y={g.y + 21} style={{ fill: ink.groupSub }} fontSize={10} textAnchor="end" fontFamily="ui-monospace, monospace">{g.feature.repo_name}</text>}
                <title>{[g.feature.name, g.feature.description, "click to zoom in"].filter(Boolean).join("\n")}</title>
              </g>
            );
          })}

          {layout.edges.map((e) => {
            const on = edgeOn(e);
            const http = e.edge.kind === "http";
            const external = e.edge.kind === "external";
            const d = e.points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
            const dim = focus && !on ? (theme === "light" ? 0.18 : 0.12) : 1;
            const stroke = on ? ink.edgeOn : http ? ink.http : external ? ink.external : ink.edge;
            return (
              <g key={e.id} data-edge onMouseEnter={() => setHoverEdge(e.id)} onMouseLeave={() => setHoverEdge(null)}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={10} />
                <path d={d} fill="none" style={{ stroke }} strokeWidth={on ? 2 : theme === "light" ? 1.4 : 1.2} strokeDasharray={http || external ? "6 4" : undefined}
                  opacity={dim} markerEnd={`url(#am-arrow${on ? "-on" : http ? "-http" : external ? "-ext" : ""})`} />
                {e.labelBox && e.label && (
                  <g opacity={focus && !on ? 0.18 : 1}>
                    <rect x={e.labelBox.x - 3} y={e.labelBox.y - 1.5} width={e.labelBox.w + 6} height={e.labelBox.h + 3} rx={4}
                      style={{ fill: ink.labelBg, stroke: ink.labelBorder }} strokeWidth={0.8} opacity={0.96} />
                    <text x={e.labelBox.x + e.labelBox.w / 2} y={e.labelBox.y + e.labelBox.h / 2 + 0.5}
                      style={{ fill: on ? (theme === "light" ? ink.edgeOn : ink.title) : http ? ink.httpText : ink.labelText }}
                      fontSize={10.5} fontWeight={http || on ? 600 : 500} textAnchor="middle" dominantBaseline="middle">{e.label}</text>
                  </g>
                )}
                <title>{e.edge.fullLabel || e.label}{e.edge.members[0]?.tags?.length ? `\ncarries: ${e.edge.members[0].tags.join(", ")}` : ""}</title>
              </g>
            );
          })}

          {layout.nodes.map((p) => <NodeShape key={p.id} p={p} theme={theme} selected={selected === p.id} lit={highlight.has(p.id)} opacity={nodeDim(p)} showTags={showTags}
            onClick={() => (p.feature && onOpenFeature ? onOpenFeature(p.feature.id) : onSelect(selected === p.id ? null : p.id))} onHover={setHover} />)}
        </g>
      </svg>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-lg border border-line bg-panel/90 p-1 shadow-sm">
        <button onClick={() => zoomBy(1.25)} aria-label="Zoom in" className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line/60 hover:text-fg"><Plus className="h-3.5 w-3.5" /></button>
        <button onClick={() => zoomBy(0.8)} aria-label="Zoom out" className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line/60 hover:text-fg"><Minus className="h-3.5 w-3.5" /></button>
        <button onClick={() => { onSelect(null); fit(); }} aria-label="Fit to view" title="Fit to view (Esc, or double-click the canvas)"
          className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-line/60 hover:text-fg"><Maximize className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

function NodeShape({ p, theme, selected, lit, opacity, showTags, onClick, onHover }: {
  p: PlacedNode; theme: Theme; selected: boolean; lit: boolean; opacity: number; showTags: boolean; onClick: () => void; onHover: (id: string | null) => void;
}) {
  const n = p.node;
  if (!n) return null;
  const ink = INK[theme];
  const isFeature = !!p.feature;
  const tints = GROUP_TINT[theme];
  const color = isFeature
    ? (p.feature!.tier === "frontend" ? tints.frontend : p.feature!.id.endsWith("data") ? tints.data : roleColor("service", theme))
    : roleColor(n.role, theme);
  const title = nodeTitle(n);
  const sub = isFeature ? `${p.count} part${p.count === 1 ? "" : "s"} · click to open` : nodeSubtitle(n);
  const tags = showTags && !isFeature && n.tags.length ? n.tags.slice(0, 3).join(" · ") : null;
  const stroke = lit ? ink.lit : selected ? color : `${color}${ink.strokeAlpha}`;
  const sw = selected || lit ? 2.4 : theme === "light" ? 1.5 : 1.3;
  const style = { fill: selected ? `${color}${ink.nodeFillSel}` : `${color}${ink.nodeFillAlpha}`, stroke };
  const cx = p.w / 2;
  let lineY = p.h / 2 - ((sub ? 7 : 0) + (tags ? 7 : 0));
  if (n.role === "entity" || n.role === "database") lineY += 6;

  let shape: React.ReactNode;
  if (n.role === "actor") {
    shape = <circle cx={cx} cy={p.h / 2} r={p.w / 2 - 2} style={style} strokeWidth={sw} />;
  } else if (n.role === "entity" || n.role === "database") {
    const ry = 7;
    shape = (
      <>
        <path d={`M0,${ry} A${cx},${ry} 0 0 1 ${p.w},${ry} V${p.h - ry} A${cx},${ry} 0 0 1 0,${p.h - ry} Z`} style={style} strokeWidth={sw} />
        <path d={`M0,${ry} A${cx},${ry} 0 0 0 ${p.w},${ry}`} fill="none" style={{ stroke }} strokeWidth={sw} />
      </>
    );
  } else if (n.role === "external") {
    const k = 14;
    shape = <path d={`M${k},0 H${p.w - k} L${p.w},${p.h / 2} L${p.w - k},${p.h} H${k} L0,${p.h / 2} Z`} style={style} strokeWidth={sw} />;
  } else {
    shape = <rect width={p.w} height={p.h} rx={isFeature ? 12 : 7} style={style} strokeWidth={sw} strokeDasharray={p.faded ? "4 3" : undefined} />;
  }
  return (
    <g data-node transform={`translate(${p.x} ${p.y})`} opacity={opacity} className="cursor-pointer transition-opacity" tabIndex={0} role="button"
      aria-label={`${title}, ${isFeature ? "feature" : ROLE_LABEL[n.role]}`} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      onMouseEnter={() => onHover(p.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(p.id)} onBlur={() => onHover(null)}>
      {lit && <rect x={-4} y={-4} width={p.w + 8} height={p.h + 8} rx={10} fill="none" style={{ stroke: ink.lit }} strokeWidth={2} className="pulse-ring" />}
      {theme === "light" && n.role !== "actor" && <rect x={1} y={2} width={p.w} height={p.h} rx={8} fill="#0f172a" opacity={0.06} />}
      {/* opaque base so boxes are not see-through over edges and group tints */}
      {n.role !== "actor" && n.role !== "entity" && n.role !== "database" && n.role !== "external" && (
        <rect width={p.w} height={p.h} rx={isFeature ? 12 : 7} style={{ fill: theme === "light" ? "#ffffff" : "#101b2d" }} />
      )}
      {shape}
      <text x={cx} y={lineY} style={{ fill: ink.title }} fontSize={isFeature ? 13.5 : 12.5} fontWeight={650} textAnchor="middle" dominantBaseline="middle">{title.length > 34 ? `${title.slice(0, 33)}…` : title}</text>
      {sub && <text x={cx} y={lineY + 15} style={{ fill: ink.sub }} fontSize={10} textAnchor="middle" dominantBaseline="middle" fontFamily={isFeature ? undefined : "ui-monospace, monospace"}>{sub.length > 40 ? `${sub.slice(0, 39)}…` : sub}</text>}
      {tags && <text x={cx} y={lineY + (sub ? 29 : 15)} style={{ fill: color }} fontSize={9.5} fontWeight={600} textAnchor="middle" dominantBaseline="middle">{tags}</text>}
      <title>{[title, isFeature ? "feature" : ROLE_LABEL[n.role], n.description, n.file ? `${n.file}${n.line ? `:${n.line}` : ""}` : null].filter(Boolean).join("\n")}</title>
    </g>
  );
}
