"use client";
import { FileCode, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { FindingRow } from "@/components/findings";
import { AUTHORITY_LABEL, StatusBadge, TYPE_LABEL } from "@/components/memoryBits";
import { Badge, ErrorBanner, Label, LoadingBlock } from "@/components/ui";
import { KIND_COLOR } from "@/components/views/ArchGraph";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { ComponentLink, Repo } from "@/lib/types";

const FILE_PREVIEW = 40;

export function ComponentPanel({ repo, nodeId, onSelect, onClose }: { repo: Repo; nodeId: string; onSelect: (id: string) => void; onClose: () => void }) {
  const { openFile, openMemory } = useApp();
  const detail = useAsync(() => api.component(repo.id, nodeId), [repo.id, nodeId]);
  const [allFiles, setAllFiles] = useState(false);
  const d = detail.data;

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
              <div className="font-mono text-[11px] text-muted">{d.node.path || "(repository root)"}</div>
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
                      <div className="flex items-start gap-2"><span className="min-w-0 flex-1 text-[13px] font-medium">{m.title}</span><span className="font-mono text-[10px] text-muted">v{m.version}</span></div>
                      <p className="mt-0.5 line-clamp-2 text-muted">{m.content}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1"><StatusBadge status={m.status} /><Badge>{TYPE_LABEL[m.memory_type]}</Badge><Badge tone={AUTHORITY_LABEL[m.authority].tone}>{AUTHORITY_LABEL[m.authority].label}</Badge></div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="grid grid-cols-2 gap-3">
              <Links title="Depends on" links={d.depends_on} onSelect={onSelect} />
              <Links title="Used by" links={d.used_by} onSelect={onSelect} />
            </section>

            <section>
              <Label>Recent commits ({d.recent_commits.length})</Label>
              {d.recent_commits.length === 0 ? <p className="text-muted">No recent commits found for this path.</p> : <div className="space-y-1">{d.recent_commits.map((f) => <FindingRow key={f.ref} f={f} />)}</div>}
            </section>

            <section>
              <Label>Files ({d.node.files.length})</Label>
              <div className="space-y-0.5">
                {(allFiles ? d.node.files : d.node.files.slice(0, FILE_PREVIEW)).map((f) => (
                  <button key={f} onClick={() => openFile(f)} title={f} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[11px] text-muted hover:bg-line/40 hover:text-fg">
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
        <ul className="space-y-0.5">
          {links.map((l) => (
            <li key={l.id}><button onClick={() => onSelect(l.id)} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-line/40"><span className="min-w-0 flex-1 truncate">{l.label}</span><span className="font-mono text-[10px] text-muted" title="number of imports">×{l.weight}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
