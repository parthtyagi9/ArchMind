"use client";
import { ChevronDown, ChevronRight, FileCode, FileText, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppState";
import { cn } from "@/components/ui";

interface TreeNode { name: string; path: string; children?: TreeNode[] }

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let next = cur.children!.find((c) => c.name === part);
      if (!next) { next = { name: part, path, children: i < parts.length - 1 ? [] : undefined }; cur.children!.push(next); }
      cur = next;
    });
  }
  const sort = (n: TreeNode) => { n.children?.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name)); n.children?.forEach(sort); };
  sort(root);
  return root.children!;
}

function Row({ node, depth, open, toggle }: { node: TreeNode; depth: number; open: Set<string>; toggle: (p: string) => void }) {
  const { activeTabId, openFile, workspace } = useApp();
  const isDir = !!node.children;
  const isOpen = open.has(node.path);
  const active = activeTabId === `file:${node.path}`;
  const hasProvenance = workspace?.demo && ["validate.ts", "balance.ts", "write.ts", "middleware.ts", "router.ts"].includes(node.name);
  return (
    <>
      <button
        onClick={() => (isDir ? toggle(node.path) : openFile(node.path))}
        className={cn("flex w-full items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px] hover:bg-line/40", active ? "bg-brand-soft text-fg" : "text-muted")}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {isDir ? (isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />) : <span className="w-3.5 shrink-0" />}
        {isDir ? <Folder className="h-3.5 w-3.5 shrink-0 text-brand/80" /> : /\.(md|txt)$/.test(node.name) ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <FileCode className="h-3.5 w-3.5 shrink-0 text-info/80" />}
        <span className="truncate">{node.name}</span>
        {hasProvenance && <span className="ml-auto text-[10px] text-brand" title="Has linked tickets, docs and memories">◆</span>}
      </button>
      {isDir && isOpen && node.children!.map((c) => <Row key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} />)}
    </>
  );
}

export function FileTree() {
  const { workspace } = useApp();
  const tree = useMemo(() => buildTree(Object.keys(workspace?.files ?? {})), [workspace]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["services", "services/auth", "services/auth/src"]));
  const toggle = (p: string) => setOpen((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  return <div className="py-1">{tree.map((n) => <Row key={n.path} node={n} depth={0} open={open} toggle={toggle} />)}</div>;
}
