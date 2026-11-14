// Layout of the architecture map with ELK (layered, top-to-bottom, orthogonal edges, features as boxes around their
// members). Coordinates are requested in root space (elk.json.shapeCoords/edgeCoords = ROOT), so nothing is nested.
import ELK from "elkjs/lib/elk.bundled.js";
import type { ArchEdge, ArchFeature, ArchMap, ArchNode, ArchRole } from "@/lib/types";

export type ArchView = { kind: "overview" } | { kind: "full" } | { kind: "feature"; featureId: string };

export interface PlacedNode { id: string; x: number; y: number; w: number; h: number; node?: ArchNode; feature?: ArchFeature; faded?: boolean; count?: number }
export interface PlacedGroup { id: string; x: number; y: number; w: number; h: number; feature: ArchFeature }
export interface PlacedEdge { id: string; points: { x: number; y: number }[]; label: string; labelBox: { x: number; y: number; w: number; h: number } | null; edge: VEdge }
export interface ArchLayout { nodes: PlacedNode[]; groups: PlacedGroup[]; edges: PlacedEdge[]; width: number; height: number }

/** An edge as drawn: an original edge, or several aggregated between two features in the overview. */
export interface VEdge { id: string; from: string; to: string; label: string; fullLabel: string; kind: ArchEdge["kind"]; members: ArchEdge[] }

const ROLE_ORDER: Record<ArchRole, number> = {
  actor: 0, router: 1, page: 2, component: 3, client: 4, endpoint: 5, job: 5, service: 6, mapper: 7, repository: 8, entity: 9, database: 10, external: 10,
};
const CHAR_W = 6.7;
const elk = new ELK();

export const nodeTitle = (n: ArchNode) => n.label || n.name;
export const nodeSubtitle = (n: ArchNode): string | null => {
  if (n.role === "actor" || n.role === "external" || n.role === "database") return null;
  const file = n.file ? n.file.split("/").pop()! : null;
  if (n.role === "page" && n.ui_route) return `${n.ui_route}${file ? ` · ${file}` : ""}`;
  return file && file.replace(/\.\w+$/, "") !== n.label ? file : null;
};

export function shortEdgeLabel(e: { kind: ArchEdge["kind"]; label: string; endpoints?: string[] }): string {
  if (e.kind === "http") {
    const m = /^HTTP\s+[A-Z, ]+\s+(.*)$/.exec(e.label);
    return m ? `HTTP ${m[1]}` : e.label;
  }
  return e.label;
}

function nodeSize(n: ArchNode, showTags: boolean): { w: number; h: number } {
  if (n.role === "actor") return { w: 84, h: 84 };
  const title = nodeTitle(n);
  const sub = nodeSubtitle(n);
  const tags = showTags && n.tags.length ? n.tags.slice(0, 3).join(" · ") : "";
  const w = Math.min(250, Math.max(140, Math.max(title.length * (CHAR_W + 0.6), (sub?.length ?? 0) * 5.9, tags.length * 5.6) + 32));
  const h = 30 + (sub ? 14 : 0) + (tags ? 14 : 0) + (n.role === "entity" || n.role === "database" ? 16 : 0);
  return { w, h: Math.max(44, h) };
}

function labelSize(text: string) {
  return { width: Math.min(260, text.length * 6.1 + 10), height: 16 };
}

// ------------------------------------------------------------------ what to draw for a view
export function viewGraph(map: ArchMap, view: ArchView): { nodes: ArchNode[]; features: ArchFeature[]; edges: VEdge[]; faded: Set<string>; overview: boolean } {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const featById = new Map(map.features.map((f) => [f.id, f]));
  if (view.kind === "overview") {
    // features become boxes; the user and external systems stay individual
    const keep = new Set(map.nodes.filter((n) => n.role === "actor" || n.role === "external").map((n) => n.id));
    const rep = (id: string) => (keep.has(id) ? id : `feature:${byId.get(id)?.feature}`);
    const agg = new Map<string, VEdge>();
    for (const e of map.edges) {
      const a = rep(e.from), b = rep(e.to);
      if (a === b || a.endsWith(":undefined") || b.endsWith(":undefined")) continue;
      const k = `${a}>${b}`;
      const cur = agg.get(k);
      if (cur) cur.members.push(e);
      else agg.set(k, { id: k, from: a, to: b, label: "", fullLabel: "", kind: e.kind, members: [e] });
    }
    for (const v of agg.values()) {
      const http = v.members.filter((e) => e.kind === "http");
      if (http.length) {
        v.kind = "http";
        v.label = "HTTP requests";
        v.fullLabel = http.map((e) => e.label).join("\n");
      } else {
        // merge verbs: "reads", "reads & saves" -> "reads & saves"
        const verbs = new Set<string>();
        for (const e of v.members) for (const w of e.label.split(/,\s*|\s*&\s*/)) if (w.trim()) verbs.add(w.trim());
        const labels = Array.from(verbs);
        v.label = labels.length === 1 ? labels[0] : labels.length <= 3 ? `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}` : `${labels.slice(0, 3).join(", ")} …`;
        v.fullLabel = labels.join("\n");
      }
    }
    const feats = map.features.filter((f) => f.id !== "external");
    const pseudo: ArchNode[] = feats.map((f) => ({
      id: `feature:${f.id}`, name: f.name, label: f.name, role: f.tier === "frontend" ? "page" : f.id.endsWith("data") ? "repository" : "service",
      tier: f.tier === "frontend" ? "frontend" : "backend", feature: f.id, file: null, line: null, tags: [], description: f.description,
    }));
    return { nodes: [...map.nodes.filter((n) => keep.has(n.id)), ...pseudo], features: [], edges: Array.from(agg.values()), faded: new Set(), overview: true };
  }
  const toV = (e: ArchEdge): VEdge => ({ id: e.id, from: e.from, to: e.to, label: shortEdgeLabel(e), fullLabel: e.label, kind: e.kind, members: [e] });
  if (view.kind === "full") {
    return { nodes: map.nodes, features: map.features, edges: map.edges.map(toV), faded: new Set(), overview: false };
  }
  // one feature: its members, plus whatever they connect to (drawn faded, outside the box)
  const f = featById.get(view.featureId);
  const members = new Set(f?.node_ids ?? []);
  const touching = map.edges.filter((e) => members.has(e.from) || members.has(e.to));
  const neighbours = new Set<string>();
  for (const e of touching) { if (!members.has(e.from)) neighbours.add(e.from); if (!members.has(e.to)) neighbours.add(e.to); }
  const nodes = [...members, ...neighbours].map((i) => byId.get(i)).filter((n): n is ArchNode => !!n);
  return { nodes, features: f ? [f] : [], edges: touching.map(toV), faded: neighbours, overview: false };
}

// ------------------------------------------------------------------ ELK
interface ElkNode { id: string; x?: number; y?: number; width?: number; height?: number; children?: ElkNode[]; layoutOptions?: Record<string, string>; labels?: { text: string; width: number; height: number }[] }
interface ElkEdge { id: string; sources: string[]; targets: string[]; labels?: { id?: string; text: string; width: number; height: number; x?: number; y?: number }[];
  sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[]; container?: string }

export async function layoutArch(map: ArchMap, view: ArchView, showTags: boolean): Promise<ArchLayout> {
  const g = viewGraph(map, view);
  const present = new Set(g.nodes.map((n) => n.id));
  const groupOf = new Map<string, string>();
  for (const f of g.features) for (const id of f.node_ids) if (present.has(id)) groupOf.set(id, f.id);
  // faded neighbours in the feature view sit outside the box
  for (const id of g.faded) groupOf.delete(id);

  g.nodes = [...g.nodes].sort((a, b) => (ROLE_ORDER[a.role] ?? 6) - (ROLE_ORDER[b.role] ?? 6));
  const sized = new Map(g.nodes.map((n) => [n.id, nodeSize(n, showTags)]));
  const leaf = (n: ArchNode): ElkNode => ({
    id: n.id, width: sized.get(n.id)!.w, height: sized.get(n.id)!.h,
    layoutOptions: {},
  });
  const top: ElkNode[] = [];
  const groups = new Map<string, ElkNode>();
  for (const f of g.features) {
    const members = g.nodes.filter((n) => groupOf.get(n.id) === f.id);
    if (!members.length) continue;
    const gn: ElkNode = {
      id: `group:${f.id}`, children: members.map(leaf),
      layoutOptions: { "elk.padding": "[top=34,left=18,bottom=18,right=18]" },
    };
    groups.set(f.id, gn);
    top.push(gn);
  }
  for (const n of g.nodes) if (!groupOf.has(n.id)) top.push(leaf(n));

  const edges: ElkEdge[] = g.edges
    .filter((e) => present.has(e.from) && present.has(e.to) && e.from !== e.to)
    .map((e) => ({ id: e.id, sources: [e.from], targets: [e.to], labels: e.label ? [{ id: `${e.id}:l`, text: e.label, ...labelSize(e.label) }] : [] }));

  const root: ElkNode & { edges: ElkEdge[] } = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": g.overview ? "90" : "56",
      "elk.spacing.nodeNode": "28",
      "elk.spacing.edgeNode": "18",
      "elk.spacing.edgeEdge": "12",
      "elk.spacing.componentComponent": "60",
      "elk.layered.spacing.edgeNodeBetweenLayers": "18",
      "elk.edgeLabels.placement": "CENTER",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
      "elk.json.shapeCoords": "ROOT",
      "elk.json.edgeCoords": "ROOT",
    },
    children: top,
    edges,
  };
  const res = (await elk.layout(root as never)) as unknown as ElkNode & { edges: ElkEdge[] };

  const nodes: PlacedNode[] = [];
  const placedGroups: PlacedGroup[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const featById = new Map(map.features.map((f) => [f.id, f]));
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      const x = c.x ?? 0, y = c.y ?? 0;
      if (c.id.startsWith("group:")) {
        const f = featById.get(c.id.slice(6))!;
        placedGroups.push({ id: c.id, x, y, w: c.width ?? 0, h: c.height ?? 0, feature: f });
        walk(c);
      } else {
        const an = byId.get(c.id);
        const fid = an && g.overview && an.id.startsWith("feature:") ? an.id.slice(8) : null;
        nodes.push({ id: c.id, x, y, w: c.width ?? 0, h: c.height ?? 0, node: an, feature: fid ? featById.get(fid) : undefined, faded: g.faded.has(c.id),
                     count: fid ? featById.get(fid)?.node_ids.length : undefined });
      }
    }
  };
  walk(res);

  const vById = new Map(g.edges.map((e) => [e.id, e]));
  const placedEdges: PlacedEdge[] = [];
  const collect = (n: ElkNode & { edges?: ElkEdge[] }) => {
    for (const e of n.edges ?? []) {
      const s = e.sections?.[0];
      if (!s) continue;
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      const l = e.labels?.[0];
      placedEdges.push({ id: e.id, points: pts, label: l?.text ?? "", edge: vById.get(e.id)!,
                         labelBox: l && l.x !== undefined ? { x: l.x, y: l.y ?? 0, w: l.width, h: l.height } : null });
    }
    for (const c of n.children ?? []) collect(c as ElkNode & { edges?: ElkEdge[] });
  };
  collect(res);
  return { nodes, groups: placedGroups, edges: placedEdges.filter((e) => e.edge), width: res.width ?? 800, height: res.height ?? 600 };
}

// ------------------------------------------------------------------ Mermaid export (for READMEs)
export function toMermaid(map: ArchMap): string {
  const ids = new Map<string, string>();
  const sid = (id: string) => { if (!ids.has(id)) ids.set(id, `n${ids.size + 1}`); return ids.get(id)!; };
  const esc = (s: string) => s.replace(/"/g, "'");
  const shape = (n: ArchNode) => {
    const text = esc(nodeSubtitle(n) ? `${nodeTitle(n)}<br/><small>${nodeSubtitle(n)}</small>` : nodeTitle(n));
    if (n.role === "actor") return `${sid(n.id)}(("${text}"))`;
    if (n.role === "entity" || n.role === "database") return `${sid(n.id)}[("${text}")]`;
    if (n.role === "external") return `${sid(n.id)}{{"${text}"}}`;
    return `${sid(n.id)}["${text}"]`;
  };
  const lines = ["flowchart TD"];
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const inFeature = new Set<string>();
  for (const f of map.features) {
    lines.push(`  subgraph ${sid(`f:${f.id}`)}["${esc(f.name)}"]`);
    for (const id of f.node_ids) { const n = byId.get(id); if (n) { lines.push(`    ${shape(n)}`); inFeature.add(id); } }
    lines.push("  end");
  }
  for (const n of map.nodes) if (!inFeature.has(n.id)) lines.push(`  ${shape(n)}`);
  for (const e of map.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    const arrow = e.kind === "http" || e.kind === "external" ? "-.->" : "-->";
    lines.push(`  ${sid(e.from)} ${arrow}|"${esc(shortEdgeLabel(e))}"| ${sid(e.to)}`);
  }
  return lines.join("\n");
}
