"use client";
import { PageGuide } from "@/components/views/GovernanceGuide";
import { Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppState";
import { StatusBadge, TYPE_LABEL, scopeLabel } from "@/components/memoryBits";
import { Badge, Button, Chip, Empty, ErrorBanner, InfoBanner, LoadingBlock, PageHeader, cn, inputCls } from "@/components/ui";
import { MemoryDetail } from "@/components/views/MemoryDetail";
import { NewMemoryForm } from "@/components/views/NewMemoryForm";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { Memory, MemoryStatus } from "@/lib/types";

const FILTERS: ("all" | MemoryStatus)[] = ["all", "pending", "active", "superseded", "invalidated", "expired", "rejected"];
const FILTER_LABEL: Record<string, string> = { invalidated: "revoked" };

interface Row { memory: Memory; score?: number }

export function MemoryView() {
  const { focusMemoryId, clearFocusMemory, can, repos, groups } = useApp();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [repoFilter, setRepoFilter] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // the filter value is "repo:<id>", "group:<id>" or "" (everything); it sets the workspace context for listing and search
  const ctx = repoFilter.startsWith("group:") ? { group_id: repoFilter.slice(6) } : repoFilter.startsWith("repo:") ? { repo_id: repoFilter.slice(5) } : {};
  const list = useAsync(() => api.memories(ctx), [repoFilter]);
  const search = useAsync(() => api.searchMemories(query, ctx), [query, repoFilter], query !== "");

  useEffect(() => {
    if (!focusMemoryId) return;
    setSelectedId(focusMemoryId); setCreating(false); setFilter("all"); setInput(""); setQuery("");
    clearFocusMemory();
  }, [focusMemoryId, clearFocusMemory]);

  const searching = query !== "";
  const base: Row[] = useMemo(() => (searching ? (search.loading ? [] : search.data?.results.map((r) => ({ memory: r.memory, score: r.score })) ?? []) : (list.data ?? []).map((memory) => ({ memory }))), [searching, search.loading, search.data, list.data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: base.length };
    for (const r of base) c[r.memory.status] = (c[r.memory.status] ?? 0) + 1;
    return c;
  }, [base]);
  const rows = base.filter((r) => filter === "all" || r.memory.status === filter);
  const loading = searching ? search.loading : list.loading && !list.data;
  const error = searching ? search.error : list.error;
  const reload = () => { list.reload(); if (searching) search.reload(); };

  const runSearch = (e: React.FormEvent) => { e.preventDefault(); setQuery(input.trim()); };
  const clearSearch = () => { setInput(""); setQuery(""); };

  return (
    <>
      <PageHeader title="Memory Inspector" sub="Every organizational memory, its authority, provenance and version history. Only memories inside your scope are listed."
        right={<Button size="sm" disabled={!can("propose_memory")} title={can("propose_memory") ? undefined : "Requires the propose_memory permission"} onClick={() => { setCreating(true); setSelectedId(null); }}><Plus className="h-3.5 w-3.5" />New memory</Button>} />
      <PageGuide page="memory" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0">
          <form onSubmit={runSearch} className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 flex-1">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted" />
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Semantic search, press Enter (governed vector search as you)" aria-label="Search memories" className={cn(inputCls, "pl-9 pr-8")} />
              {(input || query) && <button type="button" onClick={clearSearch} aria-label="Clear search" className="absolute right-2.5 top-2.5 text-muted hover:text-fg"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <select aria-label="Workspace filter" value={repoFilter} onChange={(e) => setRepoFilter(e.target.value)} className={cn(inputCls, "w-48")}>
              <option value="">All repositories and groups</option>
              {groups.length > 0 && <optgroup label="Repo groups">{groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}</optgroup>}
              <optgroup label="Repositories">{repos.map((r) => <option key={r.id} value={`repo:${r.id}`}>{r.full_name}</option>)}</optgroup>
            </select>
          </form>
          <div className="mb-3 flex flex-wrap gap-1">
            {FILTERS.map((f) => <Chip key={f} active={filter === f} onClick={() => setFilter(f)} count={counts[f] ?? 0}>{FILTER_LABEL[f] ?? f}</Chip>)}
          </div>

          {searching && search.data && (
            <InfoBanner tone={search.data.excluded > 0 ? "warn" : "info"} className="mb-3">
              {search.data.excluded > 0
                ? `${search.data.excluded} ${search.data.excluded === 1 ? "memory" : "memories"} withheld by policy (tenant, team scope, status or expiry) before ranking.`
                : "No memories were withheld by policy for this search."}
              {" "}Showing {search.data.results.length} ranked result{search.data.results.length === 1 ? "" : "s"} for “{query}”.
            </InfoBanner>
          )}

          {loading && <LoadingBlock label={searching ? "Searching…" : "Loading memories…"} />}
          {error != null && <ErrorBanner error={error} onRetry={reload} className="mb-3" />}
          {!loading && error == null && rows.length === 0 && (
            <Empty>
              {searching ? "No memories matched this search." : base.length > 0 ? `No ${FILTER_LABEL[filter] ?? filter} memories.` : "No memories yet. Create one with New memory, or propose one from an agent answer."}
            </Empty>
          )}
          <div className="space-y-2">
            {rows.map(({ memory: m, score }) => (
              <button key={m.version_id} onClick={() => { setSelectedId(m.memory_id); setCreating(false); }}
                className={cn("block w-full rounded-xl border bg-panel/80 p-3.5 text-left transition-colors hover:border-brand/60", selectedId === m.memory_id ? "border-brand" : "border-line")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.title}</div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{m.content}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[12px] text-muted">v{m.version}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge status={m.status} /><Badge>{TYPE_LABEL[m.memory_type]}</Badge><Badge>{scopeLabel(m)}</Badge>
                  {score !== undefined && <Badge tone="brand" className="font-mono">score {score.toFixed(3)}</Badge>}
                  {!m.eligible && <Badge tone="warn" title={m.exclusion_reason ?? undefined}>not retrievable{m.exclusion_reason ? `: ${m.exclusion_reason}` : ""}</Badge>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          {creating ? (
            <NewMemoryForm onCancel={() => setCreating(false)} onCreated={(m) => { setCreating(false); setSelectedId(m.memory_id); reload(); }} />
          ) : selectedId ? (
            <MemoryDetail key={selectedId} memoryId={selectedId} onChanged={reload} onPurged={() => { setSelectedId(null); reload(); }} />
          ) : (
            <Empty>Select a memory to see its content, provenance, eligibility and full version history.</Empty>
          )}
        </div>
      </div>
    </>
  );
}
