"use client";
import { Badge, type Tone } from "@/components/ui";
import type { Authority, Memory, MemoryStatus, MemoryType, SourceType } from "@/lib/types";

export const STATUS_TONE: Record<MemoryStatus, Tone> = {
  active: "ok", pending: "warn", superseded: "neutral", invalidated: "bad", expired: "bad", rejected: "bad", purged: "neutral",
};

export const STATUS_LABEL: Record<MemoryStatus, string> = {
  active: "active", pending: "pending", superseded: "superseded", invalidated: "revoked", expired: "expired", rejected: "rejected", purged: "purged",
};

export const TYPE_LABEL: Record<MemoryType, string> = {
  architecture_decision: "Architecture decision",
  bug_resolution: "Bug resolution",
  repository_convention: "Convention",
  code_ownership: "Code ownership",
  agent_experience: "Agent experience",
  engineering_preference: "Preference",
  workaround: "Workaround",
};

export const MEMORY_TYPES = Object.keys(TYPE_LABEL) as MemoryType[];

export const AUTHORITY_LABEL: Record<Authority, { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "ok" },
  human: { label: "Human-submitted", tone: "info" },
  agent_observed: { label: "Agent-observed", tone: "warn" },
};

export const SOURCE_LABEL: Record<SourceType, string> = { jira: "Jira", confluence: "Confluence", github: "GitHub", human: "Human", agent_run: "Agent run" };

export function StatusBadge({ status }: { status: MemoryStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const scopeLabel = (m: Pick<Memory, "scope" | "team" | "repo_name"> & { group_name?: string | null }) =>
  m.scope === "team" ? `team: ${m.team ?? "—"}` : m.scope === "repo" ? `repo: ${m.repo_name ?? "—"}` : m.scope === "group" ? `group: ${m.group_name ?? "—"}` : "organization";
