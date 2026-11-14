"use client";
import { ChevronDown, ChevronRight, FileCode, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { FindingRow } from "@/components/findings";
import { AUTHORITY_LABEL, StatusBadge, TYPE_LABEL } from "@/components/memoryBits";
import { Badge, ErrorBanner, Label, LoadingBlock } from "@/components/ui";
import { EDGE_STYLE, KIND_COLOR } from "@/components/views/ArchGraph";
import { api } from "@/lib/api";
import { groupPath } from "@/lib/groupData";
import { useAsync } from "@/lib/hooks";
import type { ApiCall, ApiRoute, ComponentLink, EdgeEvidence, Group, Repo } from "@/lib/types";

export type ComponentSource = { kind: "repo"; repo: Repo } | { kind: "group"; group: Group };

const FILE_PREVIEW = 40;

export function ComponentPanel({ source, nodeId, onSelect, onClose }: { source: ComponentSource; nodeId: string; onSelect: (id: string) => void; onClose: () => void }) {
  const { openFile, openMemory } = useApp();
  const sourceId = source.kind === "repo" ? source.repo.id : source.group.id;
  const detail = useAsync(() => (source.kind === "repo" ? api.component(source.repo.id, nodeId) : api.groupComponent(source.group.id, nodeId)), [source.kind, sourceId, nodeId]);
  const [allFiles, setAllFiles] = useState(false);
  const d = detail.data;
  // group workspaces address files as "<owner>/<repo>/<path>"
  const fileTab = (f: string) => (source.kind === "group" && d?.node.repo_name ? groupPath(d.node.repo_name, f) : f);

  return (
    <div className="flex h-full flex-col border-l border-line bg-panel/60">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d ? KIND_COLOR[d.node.kind] : "#8a90a8" }} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{d?.node.label ?? nodeId}</h2>
        <button onClick={onClose} aria-label="Close component details" className="text-muted hover:text-fg"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {detail.loading && !d && <LoadingBlock label="Loading component…" />}
        {detail.error != null && <ErrorBanner error={detail.error} onRetry={detail.reload} />}
        {d && (
          <>
            <div>
              {d.node.repo_name && <div className="font-mono text-[12px] text-brand">{d.node.repo_name}</div>}
              <div className="font-mono text-[12px] text-muted">{d.node.path || "(repository root)"}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="brand">{d.node.kind}</Badge>
                <Badge>{d.node.file_count} files</Badge>
                {d.node.loc > 0 && <Badge>{d.node.loc.toLocaleString()} loc</Badge>}
                {d.node.languages.map((l) => <Badge key={l} tone="info">{l}</Badge>)}
              </div>
            </div>

            <section>
              <Label>Governing memories ({d.memories.length})</Label>
              {d.memories.length === 0 ? <p className="text-muted">No governed memory applies to this component yet. Propose one from an agent answer or create it in the Memory Inspector.</p> : (
                <div className="space-y-1.5">
                  {d.memories.map((m) => (
                    <button key={m.version_id} onClick={() => openMemory(m.memory_id)} className="block w-full rounded-lg border border-line bg-panel-2 p-2.5 text-left hover:border-brand">
                      <div className="flex items-start gap-2"><span className="min-w-0 flex-1 text-[13px] font-medium">{m.title}</span><span className="font-mono text-[11px] text-muted">v{m.version}</span></div>
                      <p className="mt-0.5 line-clamp-2 text-muted">{m.content}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1"><StatusBadge status={m.status} /><Badge>{TYPE_LABEL[m.memory_type]}</Badge><Badge tone={AUTHORITY_LABEL[m.authority].tone}>{AUTHORITY_LABEL[m.authority].label}</Badge></div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <Links title="Depends on" links={d.depends_on} onSelect={onSelect} />
              <Links title="Used by" links={d.used_by} onSelect={onSelect} />
            </section>

            {(d.serves?.length ?? 0) > 0 && <Endpoints title="Serves API routes" items={d.serves!} openFile={(f) => openFile(fileTab(f))} />}
            {(d.calls?.length ?? 0) > 0 && <Endpoints title="Calls API endpoints" items={d.calls!} openFile={(f) => openFile(fileTab(f))} />}

            <section>
              <Label>Recent commits ({d.recent_commits.length})</Label>
              {d.recent_commits.length === 0 ? <p className="text-muted">No recent commits found for this path.</p> : <div className="space-y-1">{d.recent_commits.map((f) => <FindingRow key={f.ref} f={f} />)}</div>}
            </section>

            <section>
              <Label>Files ({d.node.files.length})</Label>
              <div className="space-y-0.5">
                {(allFiles ? d.node.files : d.node.files.slice(0, FILE_PREVIEW)).map((f) => (
                  <button key={f} onClick={() => openFile(fileTab(f))} title={f} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[12px] text-muted hover:bg-line/40 hover:text-fg">
                    <FileCode className="h-3 w-3 shrink-0 text-info/80" /><span className="truncate">{f}</span>
                  </button>
                ))}
              </div>
              {d.node.files.length > FILE_PREVIEW && !allFiles && <button onClick={() => setAllFiles(true)} className="mt-1 text-brand hover:underline">Show all {d.node.files.length} files</button>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Links({ title, links, onSelect }: { title: string; links: ComponentLink[]; onSelect: (id: string) => void }) {
  return (
    <div>
      <Label>{title} ({links.length})</Label>
      {links.length === 0 ? <p className="text-muted">None</p> : (
        <ul className="space-y-0.5">{links.map((l, i) => <LinkRow key={`${l.id}:${l.kind ?? "imports"}:${i}`} l={l} onSelect={onSelect} />)}</ul>
      )}
    </div>
  );
}

function LinkRow({ l, onSelect }: { l: ComponentLink; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const kind = l.kind ?? "imports";
  const detail = kind !== "imports" && ((l.endpoints?.length ?? 0) > 0 || (l.packages?.length ?? 0) > 0 || (l.evidence?.length ?? 0) > 0);
  const unit = kind === "calls_api" ? "call site" : kind === "depends_on_package" ? "import" : "import";
  return (
    <li>
      <div className="flex items-center gap-1">
        {detail ? (
          <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Show evidence" className="text-muted hover:text-fg">{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</button>
        ) : <span className="w-3" />}
        <button onClick={() => onSelect(l.id)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-line/40">
          {kind !== "imports" && <span className="shrink-0 rounded px-1 text-[10.5px] font-medium" style={{ color: EDGE_STYLE[kind].color, background: `${EDGE_STYLE[kind].color}1a` }}>{EDGE_STYLE[kind].label}</span>}
          <span className="min-w-0 flex-1 truncate">{l.cross_repo && l.repo_name ? <><span className="text-muted">{l.repo_name} · </span>{l.label}</> : l.label}</span>
          <span className="font-mono text-[11px] text-muted" title={`number of ${unit}s`}>×{l.weight}</span>
        </button>
      </div>
      {open && (
        <div className="mb-1 ml-4 space-y-1 rounded-md border border-line bg-panel-2 p-2 text-[12px]">
          {(l.endpoints ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">{l.endpoints!.map((e) => <span key={`${e.method} ${e.path}`} className="rounded bg-line/50 px-1.5 py-0.5 font-mono text-[11.5px]">{e.method} {e.path}</span>)}</div>
          )}
          {(l.packages ?? []).length > 0 && <div className="font-mono text-[11.5px]">{l.packages!.join(", ")}</div>}
          {(l.evidence ?? []).slice(0, 8).map((ev, i) => <EvidenceLine key={i} ev={ev} />)}
          {(l.evidence?.length ?? 0) > 8 && <div className="text-muted">… {l.evidence!.length - 8} more</div>}
        </div>
      )}
    </li>
  );
}

function EvidenceLine({ ev }: { ev: EdgeEvidence }) {
  const at = (repo: string | undefined, file?: string, line?: number) => `${repo ? `${repo}:` : ""}${file ?? "?"}${line ? `:${line}` : ""}`;
  if (ev.package) return <div className="font-mono text-[11.5px] text-muted">{at(ev.import_repo, ev.import_file)} → {at(ev.manifest_repo, ev.manifest_file)}</div>;
  return (
    <div className="font-mono text-[11.5px] text-muted" title={ev.score !== undefined && ev.score < 1 ? "matched with a path prefix difference" : "exact path match"}>
      <span className="text-fg">{ev.call}</span> at {at(ev.call_repo, ev.call_file, ev.call_line)}<br />→ <span className="text-fg">{ev.route}</span> at {at(ev.route_repo, ev.route_file, ev.route_line)}
      {ev.score !== undefined && ev.score < 1 && <span className="ml-1 text-warn">(prefix match)</span>}
    </div>
  );
}

const ENDPOINT_PREVIEW = 12;

function Endpoints({ title, items, openFile }: { title: string; items: (ApiRoute | ApiCall)[]; openFile: (f: string) => void }) {
  const [all, setAll] = useState(false);
  return (
    <section>
      <Label>{title} ({items.length})</Label>
      <div className="space-y-0.5">
        {(all ? items : items.slice(0, ENDPOINT_PREVIEW)).map((r, i) => (
          <button key={i} onClick={() => openFile(r.file)} title={`${r.file}:${r.line}`} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left font-mono text-[12px] hover:bg-line/40">
            <span className="w-12 shrink-0 text-[11px] text-info">{r.method}</span>
            <span className="min-w-0 flex-1 truncate">{"host" in r && r.host ? <span className="text-muted">{r.host}</span> : null}{r.path}</span>
            <span className="shrink-0 text-[11px] text-muted">{r.file.split("/").pop()}:{r.line}</span>
          </button>
        ))}
      </div>
      {items.length > ENDPOINT_PREVIEW && !all && <button onClick={() => setAll(true)} className="mt-1 text-brand hover:underline">Show all {items.length}</button>}
    </section>
  );
}
