"use client";
import { Badge, type Tone } from "@/components/ui";
import { effectiveStatus } from "@/lib/agent";
import type { Authority, Memory, MemoryStatus, MemoryType } from "@/lib/types";

export const STATUS_TONE: Record<MemoryStatus, Tone> = {
  approved: "ok", pending: "warn", superseded: "neutral", revoked: "bad", expired: "bad", rejected: "bad",
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

export const AUTHORITY_LABEL: Record<Authority, { label: string; tone: Tone }> = {
  verified: { label: "Verified", tone: "ok" },
  human: { label: "Human-submitted", tone: "info" },
  agent_observed: { label: "Agent-observed", tone: "warn" },
};

export const SOURCE_LABEL = { jira: "Jira", confluence: "Confluence", github: "GitHub", human: "Human", agent_run: "Agent run" } as const;

export function StatusBadge({ m }: { m: Memory }) {
  const s = effectiveStatus(m);
  return <Badge tone={STATUS_TONE[s]}>{s}</Badge>;
}
