"use client";
import { api } from "@/lib/api";
import { cached } from "@/lib/cache";
import { useAsync } from "@/lib/hooks";
import type { Group, Repo, Selection } from "@/lib/types";

// In a group workspace every file is addressed as "<owner>/<repo>/<path>", so the explorer shows one folder per
// repository and tabs from different repositories never collide. The API always receives (repo_id, path).

export const groupPath = (repoFullName: string, path: string) => `${repoFullName}/${path}`;

/** Resolve a group-workspace path to its repository and in-repo path. Longest repository name wins. */
export function splitGroupPath(repos: Repo[], vpath: string): { repo: Repo; path: string } | null {
  const hit = repos.filter((r) => vpath.startsWith(`${r.full_name}/`)).sort((a, b) => b.full_name.length - a.full_name.length)[0];
  return hit ? { repo: hit, path: vpath.slice(hit.full_name.length + 1) } : null;
}

/** Convert a UI selection made in a group workspace into what the API expects. */
export function apiSelection(repos: Repo[], sel: Selection): Selection {
  const s = splitGroupPath(repos, sel.path);
  return s ? { ...sel, path: s.path, repo_id: s.repo.id } : sel;
}

/** Members as the app currently knows them (live status/indexed_at from the repo list, falling back to the group payload). */
export function groupRepos(group: Group | null, repos: Repo[]): Repo[] {
  if (!group) return [];
  return group.repo_ids.map((id) => repos.find((r) => r.id === id) ?? group.repos.find((r) => r.id === id)).filter((r): r is Repo => !!r);
}

// Cache keys change whenever membership or any member's index changes.
const versionOf = (group: Group, members: Repo[]) => `${group.id}|${group.updated_at ?? ""}|${members.map((r) => `${r.id}@${r.indexed_at ?? "none"}`).join(",")}`;

export function useGroupTree(group: Group | null, members: Repo[]) {
  const v = group ? versionOf(group, members) : "";
  return useAsync(() => cached(`group:${v}|tree`, () => api.groupTree(group!.id)), [v], !!group);
}

export function useGroupGraph(group: Group | null, members: Repo[]) {
  const v = group ? versionOf(group, members) : "";
  // not cached: memory counts on nodes change as memories are approved
  return useAsync(() => api.groupGraph(group!.id), [v], !!group);
}
