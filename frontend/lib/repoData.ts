"use client";
import { api } from "@/lib/api";
import { cached } from "@/lib/cache";
import { useAsync } from "@/lib/hooks";
import type { Repo } from "@/lib/types";

// Cache keys start with `${repoId}|` (see removeRepoLocal) and embed indexed_at so a reindex yields fresh data.
const keyOf = (repo: Repo, what: string) => `${repo.id}|${repo.indexed_at ?? "none"}|${what}`;

export function useRepoTree(repo: Repo | null) {
  const ready = repo?.status === "ready";
  return useAsync(() => cached(keyOf(repo!, "tree"), () => api.tree(repo!.id)), [repo?.id, repo?.indexed_at, ready], !!repo && ready);
}

export function useRepoGraph(repo: Repo | null) {
  const ready = repo?.status === "ready";
  return useAsync(() => cached(keyOf(repo!, "graph"), () => api.graph(repo!.id)), [repo?.id, repo?.indexed_at, ready], !!repo && ready);
}

export function useRepoFile(repo: Repo | null, path: string) {
  const ready = repo?.status === "ready";
  return useAsync(() => cached(keyOf(repo!, `file|${path}`), () => api.file(repo!.id, path)), [repo?.id, repo?.indexed_at, path, ready], !!repo && ready);
}
