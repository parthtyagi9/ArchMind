"use client";
import { ChevronDown, ChevronRight, FileCode, FileText, Folder, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppState";
import { ErrorBanner, InfoBanner, Skeleton, cn, inputCls } from "@/components/ui";
import { ManageGroupButton } from "@/components/ide/ManageGroupButton";
import { groupPath, useGroupTree } from "@/lib/groupData";
import { useRepoTree } from "@/lib/repoData";
import type { Group, Repo } from "@/lib/types";

interface TreeNode { name: string; path: string; children?: TreeNode[] }

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  const dirs = new Map<string, TreeNode>([["", root]]);
  for (const p of paths) {
    const parts = p.split("/");
    let parent = root;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      if (isFile) { parent.children!.push({ name: parts[i], path }); break; }
      let dir = dirs.get(path);
      if (!dir) { dir = { name: parts[i], path, children: [] }; dirs.set(path, dir); parent.children!.push(dir); }
      parent = dir;
    }
  }
  const sort = (n: TreeNode) => { n.children?.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name)); n.children?.forEach(sort); };
  sort(root);
  return root.children!;
}

const FileIcon = ({ name }: { name: string }) =>
  /\.(md|txt)$/i.test(name) ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <FileCode className="h-3.5 w-3.5 shrink-0 text-info/80" />;

function Row({ node, depth, open, toggle }: { node: TreeNode; depth: number; open: Set<string>; toggle: (p: string) => void }) {
  const { activeTabId, openFile } = useApp();
  const isDir = !!node.children;
  const isOpen = open.has(node.path);
  const active = activeTabId === `file:${node.path}`;
  return (
    <>
      <button
        onClick={() => (isDir ? toggle(node.path) : openFile(node.path))}
        aria-expanded={isDir ? isOpen : undefined}
        className={cn("flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[13.5px] hover:bg-line/40", active ? "bg-brand-soft text-fg" : "text-muted")}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {isDir ? (isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />) : <span className="w-3.5 shrink-0" />}
        {isDir ? <Folder className="h-3.5 w-3.5 shrink-0 text-brand/80" /> : <FileIcon name={node.name} />}
        <span className="truncate">{node.name}</span>
      </button>
      {/* children of collapsed folders are never rendered, so large repos stay cheap */}
      {isDir && isOpen && node.children!.map((c) => <Row key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} />)}
    </>
  );
}

const MAX_FILTER_RESULTS = 200;

function TreeBody({ paths }: { paths: string[] }) {
  const { openFile, activeTabId } = useApp();
  const tree = useMemo(() => buildTree(paths), [paths]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const toggle = (p: string) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const f = filter.trim().toLowerCase();
  const matches = useMemo(() => (f ? paths.filter((p) => p.toLowerCase().includes(f)) : []), [paths, f]);

  return (
    <div className="py-1">
      <div className="relative px-2 pb-1.5">
        <Search className="absolute left-4 top-2 h-3 w-3 text-muted" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" aria-label="Filter files" className={cn(inputCls, "h-7 pl-7 text-[12px]")} />
      </div>
      {f ? (
        <>
          {matches.slice(0, MAX_FILTER_RESULTS).map((p) => (
            <button key={p} onClick={() => openFile(p)} title={p}
              className={cn("block w-full truncate px-3 py-[3px] text-left font-mono text-[12.5px] hover:bg-line/40", activeTabId === `file:${p}` ? "bg-brand-soft text-fg" : "text-muted")}>{p}</button>
          ))}
          {matches.length === 0 && <p className="px-3 py-2 text-xs text-muted">No files match “{filter}”.</p>}
          {matches.length > MAX_FILTER_RESULTS && <p className="px-3 py-1 text-[12px] text-muted">Showing the first {MAX_FILTER_RESULTS} of {matches.length}. Type more to narrow down.</p>}
        </>
      ) : (
        tree.map((n) => <Row key={n.path} node={n} depth={0} open={open} toggle={toggle} />)
      )}
    </div>
  );
}

function RepoTree({ repo }: { repo: Repo }) {
  const tree = useRepoTree(repo);
  const paths = useMemo(() => tree.data?.files.map((f) => f.path) ?? [], [tree.data]);

  if (repo.status === "indexing") return <p className="px-3 py-2 text-xs leading-relaxed text-muted">Indexing {repo.progress.done}/{repo.progress.total || "…"} files. The tree appears when indexing finishes.</p>;
  if (repo.status === "failed") return <div className="px-3 py-2"><InfoBanner tone="warn">Indexing failed: {repo.error ?? "unknown error"}. Reindex from the workspace picker.</InfoBanner></div>;
  if (tree.loading && !tree.data) return <div className="space-y-1.5 px-3 py-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-4" />)}</div>;
  if (tree.error != null) return <div className="p-2"><ErrorBanner error={tree.error} onRetry={tree.reload} /></div>;
  if (paths.length === 0) return <p className="px-3 py-2 text-xs text-muted">This repository has no indexable files.</p>;
  return <TreeBody paths={paths} />;
}

function GroupTree({ group, members }: { group: Group; members: Repo[] }) {
  const tree = useGroupTree(group, members);
  const paths = useMemo(() => tree.data?.files.map((f) => groupPath(f.repo_name ?? "", f.path)) ?? [], [tree.data]);
  const indexing = members.filter((r) => r.status === "indexing");
  return (
    <>
      {indexing.length > 0 && <p className="px-3 pb-1 text-[12px] text-info">{indexing.map((r) => r.full_name).join(", ")} still indexing; its files appear when it finishes.</p>}
      {tree.loading && !tree.data ? <div className="space-y-1.5 px-3 py-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-4" />)}</div>
        : tree.error != null ? <div className="p-2"><ErrorBanner error={tree.error} onRetry={tree.reload} /></div>
        : members.length === 0 ? <div className="space-y-2 px-3 py-2 text-xs text-muted"><p>This group has no repositories yet.</p><ManageGroupButton className="-ml-2" /></div>
        : paths.length === 0 ? <p className="px-3 py-2 text-xs text-muted">No indexed files yet.</p>
        : <TreeBody paths={paths} />}
      {members.length > 0 && <div className="border-t border-line/60 px-1 py-1"><ManageGroupButton /></div>}
    </>
  );
}

export function FileTree() {
  const { workspace, repo, group, groupMembers } = useApp();
  const localPaths = useMemo(() => (workspace?.kind === "local" ? Object.keys(workspace.files) : []), [workspace]);
  if (workspace?.kind === "local") return <TreeBody paths={localPaths} />;
  if (workspace?.kind === "group") return group ? <GroupTree group={group} members={groupMembers} /> : <p className="px-3 py-2 text-xs text-muted">Group not found.</p>;
  if (!repo) return <p className="px-3 py-2 text-xs text-muted">Repository not found.</p>;
  return <RepoTree repo={repo} />;
}
