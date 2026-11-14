"use client";
import { GitBranch } from "lucide-react";
import { useApp } from "@/components/AppState";

export function StatusBar() {
  const { me, workspace, repo, groupMembers, memoryOn, integrations } = useApp();
  const isGroup = workspace?.kind === "group";
  const files = workspace?.kind === "local" ? Object.keys(workspace.files).length : isGroup ? groupMembers.reduce((s, r) => s + r.file_count, 0) : repo?.file_count;
  const indexing = isGroup ? groupMembers.filter((r) => r.status === "indexing").length : 0;
  return (
    <div className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-muted">
      <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{workspace?.kind === "local" ? "local files" : isGroup ? `${groupMembers.length} repositories` : repo?.branch ?? "—"}</span>
      {files !== undefined && <span>{files} files</span>}
      {indexing > 0 && <span className="text-info">{indexing} indexing</span>}
      {repo?.status === "indexing" && <span className="text-info">indexing {repo.progress.done}/{repo.progress.total || "…"}</span>}
      <span className="ml-auto text-fg">{me.org.name}</span>
      <span>{me.org.role}{me.org.team ? ` · ${me.org.team}` : ""}</span>
      <span className={memoryOn ? "text-ok" : ""}>memory {memoryOn ? "on" : "off"}</span>
      <span className={integrations?.github.connected ? "text-ok" : ""}>
        {integrations === null ? "GitHub …" : integrations.github.connected ? `GitHub linked${integrations.github.login ? ` (${integrations.github.login})` : ""}` : "GitHub not linked"}
      </span>
    </div>
  );
}
