"use client";
import { BookOpen, FileCode, Lock, Ticket, Users } from "lucide-react";
import { useApp } from "@/components/AppState";
import { ArchGraph, KIND_COLOR } from "@/components/ArchGraph";
import { StatusBadge, TYPE_LABEL } from "@/components/memoryBits";
import { Badge, Button, Card, CardHeader, Label, PageHeader } from "@/components/ui";
import { isEligible } from "@/lib/agent";
import { EDGES, NODES } from "@/lib/mock";

export function ExplorerView() {
  const { selectedNode, setSelectedNode, highlight, setHighlight, memories, user, setView, setFocusMemoryId, workspace, openFile } = useApp();
  const node = NODES.find((n) => n.id === selectedNode) ?? null;
  const label = (id: string) => NODES.find((n) => n.id === id)?.label ?? id;
  const deps = node ? EDGES.filter((e) => e.from === node.id).map((e) => ({ id: e.to, kind: e.kind })) : [];
  const dependents = node ? EDGES.filter((e) => e.to === node.id).map((e) => ({ id: e.from, kind: e.kind })) : [];
  const nodeMemories = node ? memories.filter((m) => node.memoryIds.includes(m.id) || m.components.includes(node.id)) : [];
  const visible = nodeMemories.filter((m) => isEligible(m, user));
  const hidden = nodeMemories.length - visible.length;

  if (!workspace?.demo) {
    return (
      <>
        <PageHeader title="Architecture Explorer" sub="Services, modules and datastores extracted from the repository." />
        <Card className="grid place-items-center px-8 py-16 text-center text-xs text-muted">Architecture extraction for local folders is not built yet. Open the demo repository to explore the graph.</Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Architecture Explorer"
        sub="Services, modules and datastores extracted from the repository. Select a component to see its code, docs, tickets and the decisions that govern it."
        right={
          <div className="flex items-center gap-2">
            {highlight.length > 0 && <Button size="sm" variant="outline" onClick={() => setHighlight([])}>Clear highlight ({highlight.length})</Button>}
          </div>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="relative overflow-hidden">
          <div className="aspect-[900/570] min-h-[420px] w-full"><ArchGraph selected={selectedNode} highlight={highlight} onSelect={setSelectedNode} /></div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-muted">
            {(["service", "module", "datastore", "external"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLOR[k] }} />{k}</span>
            ))}
            <span className="flex items-center gap-1.5"><span className="h-px w-5 border-t border-dashed border-info" />imports</span>
            <span className="flex items-center gap-1.5"><span className="h-px w-5 border-t border-brand" />calls</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-warn" />referenced by last answer</span>
            <span className="ml-auto">◆ n = governing memories</span>
          </div>
        </Card>

        <Card className="max-h-[calc(100vh-190px)] overflow-y-auto">
          {!node ? (
            <div className="grid h-full min-h-[300px] place-items-center px-8 text-center text-xs text-muted">
              Select a node in the graph to inspect its source files, dependencies, documentation, tickets and approved decisions.
            </div>
          ) : (
            <>
              <CardHeader
                title={node.label}
                sub={node.purpose}
                icon={<span className="block h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLOR[node.kind] }} />}
                right={<Badge>{node.kind}</Badge>}
              />
              <div className="space-y-4 p-4">
                <div className="flex items-center gap-2 text-xs"><Users className="h-3.5 w-3.5 text-muted" /><span className="text-muted">Owner</span><span>{node.owner}</span></div>

                <div>
                  <Label>Depends on</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {deps.length ? deps.map((d) => <button key={d.id} onClick={() => setSelectedNode(d.id)}><Badge tone="brand">{label(d.id)} <span className="opacity-60">· {d.kind}</span></Badge></button>) : <span className="text-xs text-muted">none</span>}
                  </div>
                </div>
                <div>
                  <Label>Used by</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {dependents.length ? dependents.map((d) => <button key={d.id} onClick={() => setSelectedNode(d.id)}><Badge tone="info">{label(d.id)}</Badge></button>) : <span className="text-xs text-muted">none</span>}
                  </div>
                </div>

                <div>
                  <Label>Source files</Label>
                  <div className="space-y-1">
                    {node.files.length ? node.files.map((f) => (
                      <button key={f.path} onClick={() => openFile(f.path)} title="Open in editor" className="flex w-full items-center gap-2 rounded-md bg-panel-2 px-2.5 py-1.5 text-left font-mono text-[11px] hover:bg-line/60">
                        <FileCode className="h-3.5 w-3.5 shrink-0 text-muted" /><span className="truncate">{f.path}</span><span className="ml-auto text-muted">L{f.lines}</span>
                      </button>
                    )) : <span className="text-xs text-muted">No files in this repository.</span>}
                  </div>
                </div>

                <div>
                  <Label>Documentation</Label>
                  {node.docs.length ? node.docs.map((d) => (
                    <div key={d.title} className="flex items-center gap-2 py-1 text-xs"><BookOpen className="h-3.5 w-3.5 text-muted" />{d.title}<Badge className="ml-auto">Confluence</Badge></div>
                  )) : <span className="text-xs text-muted">No linked pages.</span>}
                </div>

                <div>
                  <Label>Tickets</Label>
                  {node.tickets.length ? node.tickets.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 py-1 text-xs"><Ticket className="h-3.5 w-3.5 text-muted" /><span className="font-mono text-brand">{t.id}</span><span className="truncate">{t.title}</span><Badge className="ml-auto" tone={t.status === "Done" ? "ok" : "warn"}>{t.status}</Badge></div>
                  )) : <span className="text-xs text-muted">No linked tickets.</span>}
                </div>

                <div>
                  <Label>Governing memories</Label>
                  <div className="space-y-1.5">
                    {visible.map((m) => (
                      <button key={m.id} onClick={() => { setFocusMemoryId(m.id); setView("memory"); }} className="block w-full rounded-md border border-line bg-panel-2 px-2.5 py-2 text-left hover:border-brand">
                        <div className="flex items-center gap-2"><span className="truncate text-xs font-medium">{m.title}</span><span className="ml-auto text-[11px] text-muted">v{m.version}</span></div>
                        <div className="mt-1 flex gap-1.5"><Badge>{TYPE_LABEL[m.type]}</Badge><StatusBadge m={m} /></div>
                      </button>
                    ))}
                    {visible.length === 0 && <span className="text-xs text-muted">No approved memories apply to this component.</span>}
                    {hidden > 0 && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted"><Lock className="h-3 w-3" />{hidden} not shown (other scope, pending, revoked or expired)</div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
