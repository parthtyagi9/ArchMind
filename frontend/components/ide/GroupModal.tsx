"use client";
import { Check, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppState";
import { ConnectRepoModal } from "@/components/ide/ConnectRepoModal";
import { Badge, Button, ErrorBanner, Field, InfoBanner, Modal, Spinner, cn, inputCls, textareaCls } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Group } from "@/lib/types";

/** Create a repo group, or edit one (name, description, member repositories). */
export function GroupModal({ group, onClose }: { group?: Group; onClose: () => void }) {
  const { repos, upsertGroup, can } = useApp();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [selected, setSelected] = useState<string[]>(group?.repo_ids ?? []);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A repository connected from inside this dialog is added to the group straight away.
  // For an existing group it is also saved right away, so the repo shows up in the open workspace while it indexes.
  const known = useRef(new Set(repos.map((r) => r.id)));
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const fresh = repos.filter((r) => !known.current.has(r.id)).map((r) => r.id);
    known.current = new Set(repos.map((r) => r.id));
    if (!fresh.length) return;
    const next = [...selectedRef.current, ...fresh.filter((id) => !selectedRef.current.includes(id))];
    setSelected(next);
    if (group) {
      api.updateGroup(group.id, { repo_ids: next }).then(upsertGroup, (e: unknown) => setError(errorMessage(e)));
    }
  }, [repos, group, upsertGroup]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const valid = name.trim().length > 0 && name.trim().length <= 80;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      const body = { name: name.trim(), description: description.trim(), repo_ids: selected };
      upsertGroup(group ? await api.updateGroup(group.id, body) : await api.createGroup(body));
      onClose();
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  };

  if (connecting) return <ConnectRepoModal onClose={() => setConnecting(false)} />;

  return (
    <Modal title={group ? `${group.name}: repositories` : "Create repo group"} onClose={onClose} wide>
      <form onSubmit={(e) => void save(e)} className="space-y-3">
        <p className="text-xs leading-relaxed text-muted">
          A group treats several repositories as one system, for example a notes app made of a web repo and an API repo. Its architecture map links them
          through the HTTP calls and shared packages found in the code, and agents asked inside the group search every member repository.
        </p>
        <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Notes App" maxLength={80} required autoFocus /></Field>
        <Field label="Description (optional)"><textarea className={textareaCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="What this system does" /></Field>

        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[12px] font-medium text-muted">Repositories ({selected.length} selected)</span>
            <Button type="button" size="sm" variant="ghost" className="ml-auto" disabled={!can("connect_repo")} onClick={() => setConnecting(true)}><Plus className="h-3 w-3" />Connect another repository</Button>
          </div>
          {repos.length === 0 ? (
            <InfoBanner>No repositories are connected yet. Connect one, then add it here.</InfoBanner>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line bg-panel-2 p-1.5">
              {repos.map((r) => {
                const on = selected.includes(r.id);
                return (
                  <button type="button" key={r.id} role="checkbox" aria-checked={on} onClick={() => toggle(r.id)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", on ? "bg-brand-soft text-fg" : "text-muted hover:bg-line/40 hover:text-fg")}>
                    <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-brand bg-brand text-[#0a0b10]" : "border-line")}>{on && <Check className="h-3 w-3" />}</span>
                    <span className="min-w-0 flex-1 truncate font-mono">{r.full_name}</span>
                    {r.status !== "ready" && <Badge tone={r.status === "failed" ? "bad" : "info"}>{r.status}</Badge>}
                  </button>
                );
              })}
            </div>
          )}
          {selected.length === 1 && <p className="mt-1.5 text-[12px] text-muted">Add at least one more repository to see connections between them.</p>}
        </div>

        {error && <ErrorBanner error={error} />}
        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={!valid || busy}>{busy && <Spinner className="h-3.5 w-3.5 text-[#0a0b10]" />}{group ? "Save group" : "Create group"}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
