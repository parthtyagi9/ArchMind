// Client-side layered layout of the architecture graph (the API provides no positions).
// 1. aggregate edges, drop self loops/dangling edges
// 2. break cycles with a DFS (back edges are kept for drawing but ignored for layering)
// 3. layer by longest dependency path: importers on the left, their dependencies to the right
// 4. order each layer with barycenter sweeps to reduce edge crossings
// Group maps: each repository is laid out on its own (its internal edges only) and the blocks are placed side by side,
// callers to the left of the repositories they call, so cross-repo edges mostly run left to right.
import type { EdgeKind, GraphEdge, GraphNode } from "@/lib/types";

export interface LaidNode { id: string; x: number; y: number; w: number; h: number; layer: number }
export interface LaidEdge { from: string; to: string; weight: number; cyclic: boolean; kind: EdgeKind; crossRepo: boolean; source: GraphEdge }
export interface Cluster { id: string; label: string; x: number; y: number; w: number; h: number }
export interface Layout { nodes: Map<string, LaidNode>; edges: LaidEdge[]; width: number; height: number; clusters: Cluster[] }

const GAP_X = 120;
const GAP_Y = 26;
const PAD = 40;
const SWEEPS = 6;

const edgeKey = (a: string, b: string, kind: string = "imports") => `${a}\u0000${b}\u0000${kind}`;

export function layoutGraph(nodes: GraphNode[], rawEdges: GraphEdge[]): Layout {
  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);

  const agg = new Map<string, LaidEdge>();
  for (const e of rawEdges) {
    if (e.from === e.to || !known.has(e.from) || !known.has(e.to)) continue;
    const kind = e.kind ?? "imports";
    const k = edgeKey(e.from, e.to, kind);
    const cur = agg.get(k);
    if (cur) cur.weight += e.weight || 1;
    else agg.set(k, { from: e.from, to: e.to, weight: e.weight || 1, cyclic: false, kind, crossRepo: !!e.cross_repo, source: e });
  }
  const edges = Array.from(agg.values());
  // Layering and cycle breaking work on distinct (from, to) pairs regardless of edge kind.
  const pairKey = (a: string, b: string) => `${a}\u0000${b}`;
  const pairs = new Map<string, LaidEdge[]>();
  for (const e of edges) pairs.set(pairKey(e.from, e.to), [...(pairs.get(pairKey(e.from, e.to)) ?? []), e]);

  // ---- cycle breaking
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  const hasIncoming = new Set<string>();
  for (const k of pairs.keys()) { const [a, b] = k.split("\u0000"); adj.get(a)!.push(b); hasIncoming.add(b); }
  const state = new Map<string, 1 | 2>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of adj.get(u)!) {
      const s = state.get(v);
      if (s === 1) for (const e of pairs.get(pairKey(u, v)) ?? []) e.cyclic = true;
      else if (s === undefined) visit(v);
    }
    state.set(u, 2);
  };
  for (const id of ids) if (!hasIncoming.has(id) && !state.has(id)) visit(id);
  for (const id of ids) if (!state.has(id)) visit(id);

  // ---- layering (longest path over the acyclic edge set)
  const dagOut = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of edges) {
    if (e.cyclic) continue;
    dagOut.get(e.from)!.push(e.to);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  const layerOf = new Map<string, number>(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of dagOut.get(u)!) {
      layerOf.set(v, Math.max(layerOf.get(v)!, layerOf.get(u)! + 1));
      indeg.set(v, indeg.get(v)! - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  const layerCount = Math.max(0, ...Array.from(layerOf.values())) + 1;
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of [...ids].sort((a, b) => (labelOf.get(a)! < labelOf.get(b)! ? -1 : 1))) layers[layerOf.get(id)!].push(id);

  // ---- crossing reduction
  const lower = new Map<string, string[]>(ids.map((id) => [id, []]));
  const higher = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    const [a, b] = layerOf.get(e.from)! <= layerOf.get(e.to)! ? [e.from, e.to] : [e.to, e.from];
    if (layerOf.get(a) === layerOf.get(b)) continue;
    higher.get(a)!.push(b);
    lower.get(b)!.push(a);
  }
  const pos = new Map<string, number>();
  const refreshPos = (l: number) => layers[l].forEach((id, i) => pos.set(id, (i + 0.5) / layers[l].length));
  layers.forEach((_, l) => refreshPos(l));
  const sortLayer = (l: number, neighbours: Map<string, string[]>) => {
    const bary = new Map<string, number>();
    for (const id of layers[l]) {
      const ns = neighbours.get(id)!;
      bary.set(id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!);
    }
    layers[l].sort((a, b) => bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)!);
    refreshPos(l);
  };
  for (let i = 0; i < SWEEPS; i++) {
    for (let l = 1; l < layerCount; l++) sortLayer(l, lower);
    for (let l = layerCount - 2; l >= 0; l--) sortLayer(l, higher);
  }

  // ---- coordinates
  const metric = (n: GraphNode) => (n.loc > 0 ? n.loc : n.file_count * 40);
  const maxMetric = Math.max(1, ...nodes.map(metric));
  const dims = new Map<string, { w: number; h: number }>();
  for (const n of nodes) {
    const s = Math.log1p(metric(n)) / Math.log1p(maxMetric);
    dims.set(n.id, { w: Math.round(140 + 52 * s), h: Math.round(46 + 24 * s) });
  }
  const layerHeights = layers.map((ids2) => ids2.reduce((s, id) => s + dims.get(id)!.h, 0) + GAP_Y * Math.max(0, ids2.length - 1));
  const maxHeight = Math.max(0, ...layerHeights);
  const out = new Map<string, LaidNode>();
  let x = PAD;
  layers.forEach((layerIds, l) => {
    const colW = Math.max(0, ...layerIds.map((id) => dims.get(id)!.w));
    let y = PAD + (maxHeight - layerHeights[l]) / 2;
    for (const id of layerIds) {
      const d = dims.get(id)!;
      out.set(id, { id, x: x + (colW - d.w) / 2, y, w: d.w, h: d.h, layer: l });
      y += d.h + GAP_Y;
    }
    x += colW + GAP_X;
  });

  return { nodes: out, edges, width: Math.max(1, x - GAP_X + PAD), height: maxHeight + PAD * 2, clusters: [] };
}

const CLUSTER_GAP = 170;
const CLUSTER_PAD = 26;
const CLUSTER_TITLE = 26;

/** Lay out a group map: one block per repository, ordered by cross-repo calls (callers first). */
export function layoutGroups(nodes: GraphNode[], rawEdges: GraphEdge[]): Layout {
  const repoOf = new Map(nodes.map((n) => [n.id, n.repo_id ?? ""]));
  const order: string[] = [];
  const names = new Map<string, string>();
  for (const n of nodes) { const r = n.repo_id ?? ""; if (!names.has(r)) { names.set(r, n.repo_name ?? r); order.push(r); } }

  // order blocks: longest path over the repo-level cross edges (cycles fall back to the given order)
  const out = new Map<string, Set<string>>(order.map((r) => [r, new Set()]));
  for (const e of rawEdges) {
    const a = repoOf.get(e.from), b = repoOf.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) out.get(a)!.add(b);
  }
  const rank = new Map(order.map((r) => [r, 0]));
  for (let i = 0; i < order.length; i++) {
    let changed = false;
    for (const a of order) for (const b of out.get(a)!) if (rank.get(b)! < rank.get(a)! + 1 && rank.get(a)! + 1 < order.length) { rank.set(b, rank.get(a)! + 1); changed = true; }
    if (!changed) break;
  }
  const blocks = [...order].sort((a, b) => rank.get(a)! - rank.get(b)! || names.get(a)!.localeCompare(names.get(b)!));

  const laid = blocks.map((r) => {
    const ns = nodes.filter((n) => (n.repo_id ?? "") === r);
    const ids = new Set(ns.map((n) => n.id));
    return { r, l: layoutGraph(ns, rawEdges.filter((e) => ids.has(e.from) && ids.has(e.to))) };
  });
  const height = Math.max(0, ...laid.map(({ l }) => l.height)) + CLUSTER_TITLE;
  const placed = new Map<string, LaidNode>();
  const clusters: Cluster[] = [];
  let x = 0;
  for (const { r, l } of laid) {
    const dy = (height - CLUSTER_TITLE - l.height) / 2 + CLUSTER_TITLE;
    for (const [id, n] of l.nodes) placed.set(id, { ...n, x: n.x + x, y: n.y + dy });
    clusters.push({ id: r, label: names.get(r)!, x: x + CLUSTER_PAD / 2, y: dy - CLUSTER_TITLE + CLUSTER_PAD / 2, w: l.width - CLUSTER_PAD, h: l.height + CLUSTER_TITLE - CLUSTER_PAD });
    x += l.width + CLUSTER_GAP;
  }
  // every edge (internal ones keep their per-repo cycle flags; cross-repo ones are never "cyclic")
  const internal = new Map<string, LaidEdge>();
  for (const { l } of laid) for (const e of l.edges) internal.set(edgeKey(e.from, e.to, e.kind), e);
  const edges: LaidEdge[] = [];
  const seen = new Set<string>();
  for (const e of rawEdges) {
    if (!placed.has(e.from) || !placed.has(e.to) || e.from === e.to) continue;
    const k = edgeKey(e.from, e.to, e.kind ?? "imports");
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push(internal.get(k) ?? { from: e.from, to: e.to, weight: e.weight || 1, cyclic: false, kind: e.kind ?? "imports", crossRepo: !!e.cross_repo, source: e });
  }
  return { nodes: placed, edges, width: Math.max(1, x - CLUSTER_GAP), height: height + PAD, clusters };
}
