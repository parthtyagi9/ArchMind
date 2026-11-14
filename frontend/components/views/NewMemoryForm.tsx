"use client";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { MEMORY_TYPES, TYPE_LABEL } from "@/components/memoryBits";
import { Badge, Button, Card, CardHeader, ErrorBanner, Field, InfoBanner, Label, Spinner, cn, inputCls, textareaCls } from "@/components/ui";
import { api, errorMessage, type NewMemoryBody } from "@/lib/api";
import { groupRepos, useGroupGraph } from "@/lib/groupData";
import { useRepoGraph } from "@/lib/repoData";
import type { Memory, MemoryType, Scope, SourceRef, SourceType } from "@/lib/types";

const EXPIRY: { label: string; days: number | null }[] = [
  { label: "Never", days: null }, { label: "30 days", days: 30 }, { label: "90 days", days: 90 }, { label: "365 days", days: 365 },
];
const SOURCE_TYPES: SourceType[] = ["jira", "confluence", "github", "human"];

export function NewMemoryForm({ onCreated, onCancel }: { onCreated: (m: Memory) => void; onCancel: () => void }) {
  const { me, can, repos, groups, repo: workspaceRepo, group: workspaceGroup, refreshPending } = useApp();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<MemoryType>("architecture_decision");
  const [scope, setScope] = useState<Scope>(workspaceGroup ? "group" : workspaceRepo ? "repo" : "org");
  const [groupId, setGroupId] = useState(workspaceGroup?.id ?? groups[0]?.id ?? "");
  const [team, setTeam] = useState(me.org.team ?? "");
  const [repoId, setRepoId] = useState(workspaceRepo?.id ?? repos[0]?.id ?? "");
  const [components, setComponents] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [refs, setRefs] = useState<SourceRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRepo = scope === "repo" ? repos.find((r) => r.id === repoId) ?? null : null;
  const repoGraph = useRepoGraph(selectedRepo);
  const selectedGroup = scope === "group" ? groups.find((g) => g.id === groupId) ?? null : null;
  const groupGraph = useGroupGraph(selectedGroup, groupRepos(selectedGroup, repos));
  const graph = scope === "group" ? groupGraph : repoGraph;
  const autoActive = can("approve_memory");

  const valid = title.trim() && content.trim() && (scope !== "team" || team.trim()) && (scope !== "repo" || repoId) && (scope !== "group" || groupId) && refs.every((r) => r.id.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setError(null);
    const body: NewMemoryBody = {
      title: title.trim(), content: content.trim(), memory_type: type, scope, expires_in_days: expiry,
      ...(scope === "team" ? { team: team.trim() } : {}),
      ...(scope === "repo" ? { repo_id: repoId, components } : {}),
      ...(scope === "group" ? { group_id: groupId, components } : {}),
      source_refs: refs.map((r) => ({ ...r, id: r.id.trim(), label: r.label.trim() || r.id.trim() })),
    };
    try { const m = await api.createMemory(body); void refreshPending(); onCreated(m); }
    catch (err) { setError(errorMessage(err)); setBusy(false); }
  };

  const setRef = (i: number, p: Partial<SourceRef>) => setRefs((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <Card>
      <CardHeader title="New memory" sub="A decision, convention or bug resolution your agents should respect" right={<button onClick={onCancel} aria-label="Close form" className="text-muted hover:text-fg"><X className="h-4 w-4" /></button>} />
      <form onSubmit={(e) => void submit(e)} className="space-y-3 p-4">
        <InfoBanner tone={autoActive ? "ok" : "warn"}>
          {autoActive
            ? `As ${me.org.role}, this memory is created active immediately and agents can retrieve it right away.`
            : "As a member, this memory is created pending. An admin or owner must approve it before any agent can retrieve it."}
        </InfoBanner>
        <Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} /></Field>
        <Field label="Content"><textarea className={textareaCls} rows={5} value={content} onChange={(e) => setContent(e.target.value)} required placeholder="State the decision or rule and why it exists." /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as MemoryType)}>{MEMORY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
          </Field>
          <Field label="Expires">
            <select className={inputCls} value={expiry ?? "never"} onChange={(e) => setExpiry(e.target.value === "never" ? null : Number(e.target.value))}>
              {EXPIRY.map((o) => <option key={o.label} value={o.days ?? "never"}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Scope">
            <select className={inputCls} value={scope} onChange={(e) => { setScope(e.target.value as Scope); setComponents([]); }}>
              <option value="org">Organization</option><option value="repo">Repository</option><option value="group">Repo group</option><option value="team">Team</option>
            </select>
          </Field>
          {scope === "team" && <Field label="Team"><input className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} required placeholder="e.g. platform" /></Field>}
          {scope === "group" && (
            <Field label="Repo group" hint="Retrieved only when agents work inside this group">
              {groups.length === 0 ? <div className="text-xs text-warn">Create a repo group first.</div> : (
                <select className={inputCls} value={groupId} onChange={(e) => { setGroupId(e.target.value); setComponents([]); }} required>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
            </Field>
          )}
          {scope === "repo" && (
            <Field label="Repository">
              {repos.length === 0 ? <div className="text-xs text-warn">Connect a repository first.</div> : (
                <select className={inputCls} value={repoId} onChange={(e) => { setRepoId(e.target.value); setComponents([]); }} required>
                  {repos.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                </select>
              )}
            </Field>
          )}
        </div>

        {((scope === "repo" && selectedRepo) || (scope === "group" && selectedGroup)) && (
          <div>
            <Label>Components (optional)</Label>
            {scope === "repo" && selectedRepo && selectedRepo.status !== "ready" ? <p className="text-xs text-muted">Components are available once this repository has finished indexing.</p>
              : graph.loading && !graph.data ? <p className="text-xs text-muted">Loading components…</p>
              : graph.error != null ? <ErrorBanner error={graph.error} onRetry={graph.reload} />
              : !graph.data || graph.data.nodes.length === 0 ? <p className="text-xs text-muted">No components found in this {scope === "group" ? "group" : "repository"}.</p>
              : (
                <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded-lg border border-line bg-panel-2 p-2">
                  {graph.data.nodes.map((n) => {
                    const on = components.includes(n.id);
                    return (
                      <button type="button" key={n.id} aria-pressed={on} onClick={() => setComponents((c) => (on ? c.filter((x) => x !== n.id) : [...c, n.id]))}
                        className={cn("rounded-md border px-2 py-0.5 text-[11px]", on ? "border-brand bg-brand-soft text-brand" : "border-line text-muted hover:text-fg")}>{scope === "group" && n.repo_name ? `${n.repo_name.split("/").pop()} · ${n.label}` : n.label}</button>
                    );
                  })}
                </div>
              )}
          </div>
        )}

        <div>
          <Label>Source references (optional)</Label>
          <div className="space-y-1.5">
            {refs.map((r, i) => (
              <div key={i} className="grid grid-cols-[96px_1fr_1fr_28px] gap-1.5">
                <select aria-label="Source type" className={inputCls} value={r.type} onChange={(e) => setRef(i, { type: e.target.value as SourceType })}>{SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <input aria-label="Source id" className={inputCls} placeholder="AUTH-311, PR #377…" value={r.id} onChange={(e) => setRef(i, { id: e.target.value })} />
                <input aria-label="Source label" className={inputCls} placeholder="Label" value={r.label} onChange={(e) => setRef(i, { label: e.target.value })} />
                <button type="button" aria-label="Remove source" onClick={() => setRefs((rs) => rs.filter((_, j) => j !== i))} className="text-muted hover:text-bad"><X className="mx-auto h-3.5 w-3.5" /></button>
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" onClick={() => setRefs((rs) => [...rs, { type: "jira", id: "", label: "", url: null }])}><Plus className="h-3 w-3" />Add source</Button>
          </div>
        </div>

        {error && <ErrorBanner error={error} />}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={!valid || busy}>{busy && <Spinner className="h-3.5 w-3.5 text-[#0a0b10]" />}Create memory</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Badge className="ml-auto">{autoActive ? "will be active" : "will be pending"}</Badge>
        </div>
      </form>
    </Card>
  );
}
