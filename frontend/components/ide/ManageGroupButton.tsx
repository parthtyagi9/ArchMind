"use client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/AppState";
import { ConnectRepoModal } from "@/components/ide/ConnectRepoModal";
import { Button, cn } from "@/components/ui";

/** Connect a GitHub repository straight into the open group. */
export function ManageGroupButton({ variant = "link", className }: { variant?: "link" | "button"; className?: string }) {
  const { group, can } = useApp();
  const [open, setOpen] = useState(false);
  if (!group) return null;
  const allowed = can("connect_repo");
  const title = allowed ? "Add or connect repositories in this group" : "Requires the connect_repo permission (admin or owner)";
  return (
    <>
      {variant === "button" ? (
        <Button size="sm" disabled={!allowed} title={title} onClick={() => setOpen(true)} className={className}><Plus className="h-3.5 w-3.5" />Add repositories</Button>
      ) : (
        <button disabled={!allowed} title={title} onClick={() => setOpen(true)}
          className={cn("flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-brand hover:bg-line/50 disabled:cursor-not-allowed disabled:opacity-50", className)}>
          <Plus className="h-3 w-3" />Add repositories
        </button>
      )}
      {open && <ConnectRepoModal groupId={group.id} onClose={() => setOpen(false)} />}
    </>
  );
}
