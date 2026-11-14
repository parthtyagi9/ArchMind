"use client";
import { ChevronDown, ChevronRight, Copy, FileCode, MessageSquare, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppState";
import { Badge, Button, Empty, ErrorBanner, Label, LoadingBlock, Skeleton, Spinner, cn } from "@/components/ui";
import { ArchDiagram, ROLE_STYLE, roleColor } from "@/components/views/ArchDiagram";
import { useTheme } from "@/lib/theme";
import { useArchMap, type ArchSource } from "@/lib/archData";
import { layoutArch, nodeTitle, shortEdgeLabel, toMermaid, type ArchLayout, type ArchView } from "@/lib/archLayout";
import { groupPath } from "@/lib/groupData";
import type { ArchEdge, ArchMap, ArchNode, ArchRole } from "@/lib/types";

const FULL_MAP_LIMIT = 45;

export function ArchMapView({ source, folders }: { source: ArchSource; folders: React.ReactNode }) {
  const { highlight, setHighlight, archFeature, setArchFeature } = useApp();
  const theme = useTheme();
  const arch = useArchMap(source);
  const map = arch.data;
  const [mode, setMode] = useState<"auto" | "overview" | "full" | "folders">("auto");
  const [showTags, setShowTags] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [layout, setLayout] = useState<ArchLayout | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const effective = mode === "auto" ? (map && map.nodes.length > FULL_MAP_LIMIT ? "overview" : "full") : mode;
  const featureOk = !!(archFeature && map?.features.some((f) => f.id === archFeature));
  const view: ArchView | null = effective === "folders" ? null : featureOk ? { kind: "feature", featureId: archFeature! } : effective === "overview" ? { kind: "overview" } : { kind: "full" };
  const viewKey = view ? (view.kind === "feature" ? `f:${view.featureId}` : view.kind) : "folders";

  useEffect(() => {
    if (!map || !view) return;
    let cancelled = false;
    setLayoutError(null);
    layoutArch(map, view, showTags).then((l) => { if (!cancelled) setLayout(l); }, (e: unknown) => { if (!cancelled) setLayoutError(String(e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, viewKey, showTags]);

  // agent answers name folder components; light up the boxes that live in them
  const lit = useMemo(() => {
    const s = new Set<string>();
    if (!map || !highlight.length) return s;
    const hl = new Set(highlight);
    for (const n of map.nodes) if (n.component && (hl.has(n.component) || (n.repo_id && hl.has(`${n.repo_id}:${n.component}`)))) s.add(n.id);
    return s;
  }, [map, highlight]);

  if (source.kind === "repo" && source.repo.status !== "ready") return <Center><Empty>The architecture map is built when indexing finishes.</Empty></Center>;
  if (arch.loading && !map) return <div className="p-5"><Skeleton className="h-[420px]" /><LoadingBlock label="Reading the code…" /></div>;
  if (arch.error != null) return <Center><ErrorBanner error={arch.error} onRetry={arch.reload} /></Center>;
  if (!map) return null;

  const feature = featureOk ? map.features.find((f) => f.id === archFeature) : null;
  const selNode = selected ? map.nodes.find((n) => n.id === selected) ?? null : null;
  const rolesShown = Array.from(new Set(map.nodes.map((n) => n.role))) as ArchRole[];
  const copyMermaid = async () => {
    try { await navigator.clipboard.writeText(toMermaid(map)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs">
          <div className="flex rounded-lg border border-line p-0.5">
            {(["overview", "full", "folders"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setArchFeature(null); setSelected(null); }} aria-pressed={effective === m && !feature}
                className={cn("rounded-md px-2.5 py-1 text-[11px]", effective === m && !feature ? "bg-brand-soft text-fg" : "text-muted hover:text-fg")}>
                {m === "overview" ? "Overview" : m === "full" ? "Full map" : "Folders"}
              </button>
            ))}
          </div>
          {feature && (
            <span className="flex items-center gap-1 text-[11px]">
              <button className="text-muted hover:text-fg" onClick={() => setArchFeature(null)}>{effective === "overview" ? "Overview" : "Full map"}</button>
              <ChevronRight className="h-3 w-3 text-muted" /><span className="font-medium">{feature.name}</span>
              <button aria-label="Close feature" className="ml-1 text-muted hover:text-fg" onClick={() => setArchFeature(null)}><X className="h-3 w-3" /></button>
            </span>
          )}
          {effective !== "folders" && (
            <>
              <span className="text-muted">{map.nodes.length} parts · {map.edges.length} links</span>
              <label className="ml-2 flex cursor-pointer items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} />data types</label>
              <NamingStatus arch={arch} />
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void copyMermaid()} title="Copy the full map as a Mermaid diagram for a README">
                <Copy className="h-3 w-3" />{copied ? "Copied" : "Copy as Mermaid"}
              </Button>
            </>
          )}
          {highlight.length > 0 && effective !== "folders" && (
            <button onClick={() => setHighlight([])} className="flex items-center gap-1 rounded-md bg-warn-soft px-2 py-1 text-[11px] text-warn hover:bg-warn/20">
              <X className="h-3 w-3" />Clear highlight
            </button>
          )}
        </div>
        {effective !== "folders" && map.labels?.summary && !feature && <div className="border-b border-line px-4 py-1.5 text-[11px] text-muted">{map.labels.summary}</div>}
        {feature?.description && <div className="border-b border-line px-4 py-1.5 text-[11px] text-muted">{feature.description}</div>}

        {effective === "folders" ? <div className="min-h-0 flex-1">{folders}</div> : (
          <div className="relative min-h-0 flex-1 canvas-dots">
            {layoutError ? <Center><ErrorBanner error={`Layout failed: ${layoutError}`} /></Center>
              : !layout ? <LoadingBlock label="Laying out…" />
              : map.nodes.length <= 1 ? <Center><Empty>No architecture parts were recognised in this code yet.</Empty></Center>
              : <ArchDiagram key={viewKey} layout={layout} selected={selected} highlight={lit} showTags={showTags}
                  onSelect={setSelected} onOpenFeature={(f) => { setArchFeature(f); setSelected(null); }} />}
            <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[70%] flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line bg-panel/90 px-2.5 py-1.5 text-[10px] text-muted">
              {rolesShown.filter((r) => r !== "actor").map((r) => <span key={r} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: roleColor(r, theme) }} />{ROLE_STYLE[r].label}</span>)}
              <span className="flex items-center gap-1"><svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" style={{ stroke: theme === "light" ? "#0f766e" : "#2dd4bf" }} strokeWidth="2" strokeDasharray="5 3" /></svg>HTTP</span>
              <span>· click a box to zoom in · Esc to zoom out</span>
              {view?.kind === "overview" && <span>· click a feature to open it</span>}
            </div>
          </div>
        )}
      </div>
      {selNode && effective !== "folders" && (
        <div className="w-[380px] shrink-0"><ArchNodePanel map={map} node={selNode} source={source} onSelect={setSelected} onClose={() => setSelected(null)} /></div>
      )}
    </div>
  );
}

function NamingStatus({ arch }: { arch: ReturnType<typeof useArchMap> }) {
  const m = arch.data!;
  if (arch.naming === "running") return <span className="flex items-center gap-1 text-[11px] text-muted"><Spinner className="h-3 w-3" />naming with Gemini…</span>;
  if (m.labels) return <Badge tone="brand" title={`Names and descriptions by ${m.labels.model ?? "Gemini"}; boxes and arrows come from the code`}><Sparkles className="h-3 w-3" />named by Gemini</Badge>;
  if (m.labels_status === "unavailable") return <span className="text-[11px] text-muted" title="Set GEMINI_API_KEY to get friendly names">code names</span>;
  return (
    <button onClick={arch.requestNames} className="flex items-center gap-1 text-[11px] text-brand hover:underline" title={arch.namingError ?? undefined}>
      {arch.naming === "error" ? <RefreshCw className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}{arch.naming === "error" ? "Naming failed, retry" : "Name with Gemini"}
    </button>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto px-5 py-4"><div className="mx-auto max-w-xl pt-10">{children}</div></div>;
}

// ------------------------------------------------------------------ details of one box
function ArchNodePanel({ map, node, source, onSelect, onClose }: { map: ArchMap; node: ArchNode; source: ArchSource; onSelect: (id: string) => void; onClose: () => void }) {
  const { openFile, requestAsk, can } = useApp();
  const byId = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map]);
  const out = map.edges.filter((e) => e.from === node.id);
  const inc = map.edges.filter((e) => e.to === node.id);
  const theme = useTheme();
  const st = { ...ROLE_STYLE[node.role], color: roleColor(node.role, theme) };
  const feature = map.features.find((f) => f.id === node.feature);
  const tab = node.file ? (source.kind === "group" && node.repo_name ? groupPath(node.repo_name, node.file) : node.file) : null;

  return (
    <div className="flex h-full flex-col border-l border-line bg-panel/60">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: st.color }} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{nodeTitle(node)}</h2>
        <button onClick={onClose} aria-label="Close details" className="text-muted hover:text-fg"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Badge style={{ color: st.color }}>{st.label}</Badge>
            {feature && <Badge>{feature.name}</Badge>}
            {node.repo_name && <Badge className="font-mono">{node.repo_name}</Badge>}
          </div>
          {node.description && <p className="leading-relaxed text-fg/90">{node.description}</p>}
          {node.name !== node.label && node.role !== "actor" && <p className="font-mono text-[11px] text-muted">{node.name}</p>}
          {tab && (
            <button onClick={() => openFile(tab)} className="flex items-center gap-1.5 font-mono text-[11px] text-brand hover:underline">
              <FileCode className="h-3 w-3" />{node.file}{node.line ? `:${node.line}` : ""}
            </button>
          )}
          {node.ui_route && <p className="text-muted">Screen at <span className="font-mono text-fg">{node.ui_route}</span></p>}
          {node.schedule && <p className="font-mono text-[11px] text-muted">{node.schedule}</p>}
          {node.store && <p className="text-muted">Stored in <span className="text-fg">{node.store}</span></p>}
        </div>

        {node.tags.length > 0 && (
          <section><Label>Data types it uses</Label><div className="flex flex-wrap gap-1">{node.tags.map((t) => <Badge key={t} className="font-mono">{t}</Badge>)}</div></section>
        )}
        {(node.routes?.length ?? 0) > 0 && (
          <section>
            <Label>HTTP routes it serves ({node.routes!.length})</Label>
            <div className="space-y-0.5 font-mono text-[11px]">{node.routes!.map((r) => <div key={r}><span className="text-info">{r.split(" ")[0]}</span> {r.split(" ").slice(1).join(" ")}</div>)}</div>
          </section>
        )}
        <Links title="Calls / depends on" edges={out} other={(e) => byId.get(e.to)} onSelect={onSelect} />
        <Links title="Used by" edges={inc} other={(e) => byId.get(e.from)} onSelect={onSelect} />

        {node.role !== "actor" && can("ask") && (
          <Button size="sm" variant="outline" onClick={() => requestAsk(`What does ${nodeTitle(node)}${node.file ? ` (${node.file})` : ""} do, and why does it exist?`, null)}>
            <MessageSquare className="h-3.5 w-3.5" />Ask ArchMind about this
          </Button>
        )}
      </div>
    </div>
  );
}

function Links({ title, edges, other, onSelect }: { title: string; edges: ArchEdge[]; other: (e: ArchEdge) => ArchNode | undefined; onSelect: (id: string) => void }) {
  return (
    <section>
      <Label>{title} ({edges.length})</Label>
      {edges.length === 0 ? <p className="text-muted">None</p> : <ul className="space-y-0.5">{edges.map((e) => <LinkRow key={e.id} e={e} n={other(e)} onSelect={onSelect} />)}</ul>}
    </section>
  );
}

function LinkRow({ e, n, onSelect }: { e: ArchEdge; n: ArchNode | undefined; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  if (!n) return null;
  const detail = (e.evidence?.length ?? 0) > 0 || e.endpoints.length > 0 || e.methods.length > 0 || e.tags.length > 0;
  return (
    <li>
      <div className="flex items-center gap-1">
        {detail ? <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Show details" className="text-muted hover:text-fg">{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</button> : <span className="w-3" />}
        <button onClick={() => onSelect(n.id)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-line/40">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: roleColor(n.role, theme) }} />
          <span className="min-w-0 flex-1 truncate">{nodeTitle(n)}</span>
          <span className={cn("shrink-0 text-[10px]", e.kind === "http" ? (theme === "light" ? "text-teal-700" : "text-teal-300") : "text-muted")}>{shortEdgeLabel(e)}</span>
        </button>
      </div>
      {open && (
        <div className="mb-1 ml-4 space-y-1 rounded-md border border-line bg-panel-2 p-2 text-[11px]">
          {e.endpoints.length > 0 && <div className="flex flex-wrap gap-1">{e.endpoints.map((x) => <span key={x} className="rounded bg-line/50 px-1.5 py-0.5 font-mono text-[10.5px]">{x}</span>)}</div>}
          {e.methods.length > 0 && <div className="text-muted">methods called: <span className="font-mono text-fg">{e.methods.slice(0, 10).join(", ")}</span></div>}
          {e.tags.length > 0 && <div className="text-muted">carries: <span className="font-mono text-fg">{e.tags.join(", ")}</span></div>}
          {(e.evidence ?? []).slice(0, 6).map((ev, i) => (
            <div key={i} className="font-mono text-[10.5px] text-muted">
              <span className="text-fg">{ev.call}</span> at {ev.call_repo ? `${ev.call_repo}:` : ""}{ev.call_file}:{ev.call_line}<br />→ <span className="text-fg">{ev.route}</span> at {ev.route_repo ? `${ev.route_repo}:` : ""}{ev.route_file}:{ev.route_line}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
