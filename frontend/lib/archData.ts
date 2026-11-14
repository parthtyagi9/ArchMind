"use client";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import type { ArchMap, Group, Repo } from "@/lib/types";

export type ArchSource = { kind: "repo"; repo: Repo } | { kind: "group"; group: Group; members: Repo[] };

const versionOf = (s: ArchSource) =>
  s.kind === "repo" ? `${s.repo.id}@${s.repo.indexed_at ?? "none"}` : `${s.group.id}|${s.group.updated_at ?? ""}|${s.members.map((r) => `${r.id}@${r.indexed_at ?? "none"}`).join(",")}`;

/** Loads the architecture map, then (once per map version) asks Gemini for friendly names in the background. */
export function useArchMap(source: ArchSource | null) {
  const v = source ? versionOf(source) : "";
  const ready = !source || source.kind === "group" || source.repo.status === "ready";
  const map = useAsync(() => (source!.kind === "repo" ? api.archmap(source!.repo.id) : api.groupArchmap(source!.group.id)), [v], !!source && ready);
  const [named, setNamed] = useState<ArchMap | null>(null);
  const [naming, setNaming] = useState<"idle" | "running" | "error">("idle");
  const [namingError, setNamingError] = useState<string | null>(null);
  const asked = useRef<string | null>(null);

  useEffect(() => { setNamed(null); setNaming("idle"); setNamingError(null); }, [v]);

  const requestNames = () => {
    if (!source) return;
    setNaming("running"); setNamingError(null);
    const call = source.kind === "repo" ? api.archmapLabels(source.repo.id) : api.groupArchmapLabels(source.group.id);
    call.then((m) => { setNamed(m); setNaming("idle"); }, (e: unknown) => { setNaming("error"); setNamingError(errorMessage(e)); });
  };

  useEffect(() => {
    const m = map.data;
    if (!m || m.labels_status !== "missing" || asked.current === `${v}|${m.fingerprint}`) return;
    asked.current = `${v}|${m.fingerprint}`;
    requestNames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.data, v]);

  return { data: named ?? map.data, loading: map.loading, error: map.error, reload: map.reload, naming, namingError, requestNames, ready };
}
