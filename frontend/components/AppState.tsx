"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, errorMessage, UNAUTHORIZED_EVENT } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { groupRepos } from "@/lib/groupData";
import type { Group, Integrations, Me, PageId, Permission, Repo, Selection, Tab, Workspace } from "@/lib/types";

export type SidebarPanel = "files" | "arch" | "gov";
export type BootStatus = "loading" | "signed_out" | "ready" | "error";

export interface Notice { kind: "error" | "ok"; text: string }
export interface AskRequest { nonce: number; question: string; selection: Selection | null }
export interface ComparePrefill { nonce: number; question: string; selection: Selection | null; repoId: string | null; groupId?: string | null }

interface AppState {
  status: BootStatus;
  bootError: string | null;
  retryBoot: () => void;
  me: Me | null;
  can: (p: Permission) => boolean;
  signedIn: (me: Me) => void;
  signOut: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  createOrg: (name: string) => Promise<void>;
  notice: Notice | null;
  setNotice: (n: Notice | null) => void;

  pendingCount: number;
  refreshPending: () => Promise<void>;

  integrations: Integrations | null;
  refreshIntegrations: () => Promise<void>;

  repos: Repo[];
  reposLoading: boolean;
  reposError: string | null;
  refreshRepos: () => Promise<void>;
  upsertRepo: (r: Repo) => void;
  removeRepoLocal: (id: string) => void;

  groups: Group[];
  groupsError: string | null;
  refreshGroups: () => Promise<void>;
  upsertGroup: (g: Group) => void;
  removeGroupLocal: (id: string) => void;

  workspace: Workspace | null;
  repo: Repo | null; // the repo of the open workspace, if any
  group: Group | null; // the group of the open workspace, if any
  groupMembers: Repo[]; // its repositories, with live indexing status
  openRepo: (id: string) => void;
  openGroup: (id: string) => void;
  openLocal: (name: string, files: Record<string, string>) => void;
  closeWorkspace: () => void;
  settingsOpen: boolean;
  setSettingsOpen: (b: boolean) => void;

  tabs: Tab[];
  activeTabId: string | null;
  setActiveTabId: (id: string) => void;
  openFile: (path: string) => void;
  openPage: (page: PageId) => void;
  openArch: () => void;
  closeTab: (id: string) => void;
  sidebar: SidebarPanel;
  setSidebar: (p: SidebarPanel) => void;

  memoryOn: boolean;
  setMemoryOn: (b: boolean) => void;
  pendingSelection: Selection | null;
  setPendingSelection: (s: Selection | null) => void;
  activeRange: Selection | null;
  setActiveRange: (s: Selection | null) => void;
  askRequest: AskRequest | null;
  requestAsk: (question: string, selection: Selection | null) => void;

  highlight: string[];
  setHighlight: (ids: string[]) => void;
  showInArchitecture: (ids: string[]) => void;
  selectedNode: string | null;
  setSelectedNode: (id: string | null) => void;

  focusMemoryId: string | null;
  clearFocusMemory: () => void;
  openMemory: (memoryId: string) => void;
  selectedRunId: string | null;
  openRun: (runId: string) => void;
  comparePrefill: ComparePrefill | null;
  openCompare: (p: { question: string; selection: Selection | null; repoId: string | null; groupId?: string | null }) => void;
}

const Ctx = createContext<AppState | null>(null);

/** Use inside the signed-in app: `me` is guaranteed. */
export function useApp(): AppState & { me: Me } {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  if (!c.me) throw new Error("useApp used before sign-in");
  return c as AppState & { me: Me };
}

/** Use at the root / auth screen where `me` may be null. */
export function useAppRaw(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAppRaw outside provider");
  return c;
}

const PAGE_TITLES: Record<PageId, string> = {
  governance: "Governance overview", memory: "Memory Inspector", approvals: "Approval Center", history: "Decision History", runs: "Agent Run Inspector", compare: "Memory Impact", settings: "Settings",
};
export const pageTitle = (p: PageId) => PAGE_TITLES[p];

const REPO_POLL_MS = 1500;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<BootStatus>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootTick, setBootTick] = useState(0);
  const [me, setMe] = useState<Me | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<SidebarPanel>("files");

  const [memoryOn, setMemoryOn] = useState(true);
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(null);
  const [activeRange, setActiveRange] = useState<Selection | null>(null);
  const [askRequest, setAskRequest] = useState<AskRequest | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [focusMemoryId, setFocusMemoryId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [comparePrefill, setComparePrefill] = useState<ComparePrefill | null>(null);
  const nonce = useRef(0);

  // ---------- session-scoped resets
  const resetWorkspaceState = useCallback(() => {
    setWorkspace(null); setTabs([]); setActiveTabId(null); setSettingsOpen(false);
    setPendingSelection(null); setActiveRange(null); setAskRequest(null); setHighlight([]);
    setSelectedNode(null); setFocusMemoryId(null); setSelectedRunId(null); setComparePrefill(null);
  }, []);

  const loadRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try { setRepos(await api.repos()); }
    catch (e) { setReposError(errorMessage(e)); }
    finally { setReposLoading(false); }
  }, []);

  const loadGroups = useCallback(async () => {
    setGroupsError(null);
    try { setGroups(await api.groups()); }
    catch (e) { setGroupsError(errorMessage(e)); }
  }, []);

  const refreshIntegrations = useCallback(async () => {
    try { setIntegrations(await api.integrations()); } catch { /* non-fatal: status bar falls back to "unknown" */ }
  }, []);

  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const refreshPending = useCallback(async () => {
    if (!meRef.current?.org.permissions.includes("approve_memory")) { setPendingCount(0); return; }
    try { setPendingCount((await api.memories({ status: "pending" })).length); } catch { /* badge only; the Approval Center shows real errors */ }
  }, []);

  const afterSignIn = useCallback((m: Me) => {
    meRef.current = m;
    setMe(m);
    setStatus("ready");
    void loadRepos();
    void loadGroups();
    void refreshIntegrations();
    void refreshPending();
  }, [loadRepos, loadGroups, refreshIntegrations, refreshPending]);

  // keep the pending-approval badge fresh
  useEffect(() => {
    if (status !== "ready") return;
    const t = setInterval(() => void refreshPending(), 30_000);
    return () => clearInterval(t);
  }, [status, refreshPending]);

  const signedOut = useCallback(() => {
    setMe(null); setStatus("signed_out"); setRepos([]); setGroups([]); setIntegrations(null); setPendingCount(0); resetWorkspaceState();
  }, [resetWorkspaceState]);

  // ---------- bootstrap: /auth/me then /repos
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    api.me().then(
      (m) => { if (!cancelled) afterSignIn(m); },
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) { setStatus("signed_out"); return; }
        setBootError(errorMessage(e));
        setStatus("error");
      },
    );
    return () => { cancelled = true; };
  }, [bootTick, afterSignIn]);

  // session expired mid-use
  useEffect(() => {
    const h = () => signedOut();
    window.addEventListener(UNAUTHORIZED_EVENT, h);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, h);
  }, [signedOut]);

  // ?auth_error= / ?connected=github from OAuth redirects
  useEffect(() => {
    const url = new URL(window.location.href);
    const err = url.searchParams.get("auth_error");
    const connected = url.searchParams.get("connected");
    if (!err && !connected) return;
    if (err) setNotice({ kind: "error", text: err });
    else if (connected === "github") setNotice({ kind: "ok", text: "GitHub account linked. Private repositories you can read are now available." });
    url.searchParams.delete("auth_error");
    url.searchParams.delete("connected");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  // ---------- repo status polling (every 1.5s while indexing)
  const upsertRepo = useCallback((r: Repo) => setRepos((rs) => (rs.some((x) => x.id === r.id) ? rs.map((x) => (x.id === r.id ? r : x)) : [r, ...rs])), []);
  const removeRepoLocal = useCallback((id: string) => {
    setRepos((rs) => rs.filter((x) => x.id !== id));
    setGroups((gs) => gs.map((g) => (g.repo_ids.includes(id) ? { ...g, repo_ids: g.repo_ids.filter((r) => r !== id), repos: g.repos.filter((r) => r.id !== id), updated_at: new Date().toISOString() } : g)));
    setWorkspace((w) => (w?.kind === "repo" && w.repoId === id ? null : w));
    invalidate(`${id}|`);
  }, []);

  const upsertGroup = useCallback((g: Group) => setGroups((gs) => (gs.some((x) => x.id === g.id) ? gs.map((x) => (x.id === g.id ? g : x)) : [...gs, g].sort((a, b) => a.name.localeCompare(b.name)))), []);
  const removeGroupLocal = useCallback((id: string) => {
    setGroups((gs) => gs.filter((g) => g.id !== id));
    setWorkspace((w) => (w?.kind === "group" && w.groupId === id ? null : w));
  }, []);

  // keep polling while a repo indexes, and while its semantic code search is still embedding in the background
  const indexingKey = repos.filter((r) => r.status === "indexing" || r.search?.status === "embedding").map((r) => r.id).join(",");
  useEffect(() => {
    if (!indexingKey) return;
    const ids = indexingKey.split(",");
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await Promise.all(ids.map(async (id) => {
        try {
          const r = await api.repo(id);
          if (!stopped) upsertRepo(r);
        } catch (e) {
          if (!stopped && e instanceof ApiError && e.status === 404) removeRepoLocal(id);
        }
      }));
      if (!stopped) timer = setTimeout(tick, REPO_POLL_MS);
    };
    timer = setTimeout(tick, REPO_POLL_MS);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [indexingKey, upsertRepo, removeRepoLocal]);

  // ---------- auth actions
  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* the cookie may already be gone; sign out locally regardless */ }
    signedOut();
  }, [signedOut]);

  const switchOrg = useCallback(async (orgId: string) => {
    const m = await api.switchOrg(orgId);
    resetWorkspaceState();
    setRepos([]);
    setGroups([]);
    afterSignIn(m);
  }, [afterSignIn, resetWorkspaceState]);

  const createOrg = useCallback(async (name: string) => {
    const m = await api.createOrg(name);
    resetWorkspaceState();
    setRepos([]);
    setGroups([]);
    afterSignIn(m);
  }, [afterSignIn, resetWorkspaceState]);

  // ---------- workspace + tabs
  const focusTab = useCallback((t: Tab) => {
    setTabs((ts) => (ts.some((x) => x.id === t.id) ? ts : [...ts, t]));
    setActiveTabId(t.id);
  }, []);

  const openFile = useCallback((path: string) => focusTab({ id: `file:${path}`, kind: "file", path }), [focusTab]);
  const openArch = useCallback(() => { setSidebar("arch"); focusTab({ id: "arch", kind: "arch" }); }, [focusTab]);
  const openPage = useCallback((page: PageId) => {
    if (!workspace) { if (page === "settings") setSettingsOpen(true); return; }
    focusTab({ id: `page:${page}`, kind: "page", page });
  }, [focusTab, workspace]);

  const closeTab = useCallback((id: string) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      setActiveTabId((cur) => (cur === id ? next[Math.min(i, next.length - 1)]?.id ?? null : cur));
      return next;
    });
  }, []);

  const startWorkspace = useCallback((w: Workspace) => {
    resetWorkspaceState();
    setWorkspace(w);
    setSidebar("files");
  }, [resetWorkspaceState]);
  const openRepo = useCallback((id: string) => startWorkspace({ kind: "repo", repoId: id }), [startWorkspace]);
  const openGroup = useCallback((id: string) => startWorkspace({ kind: "group", groupId: id }), [startWorkspace]);
  const openLocal = useCallback((name: string, files: Record<string, string>) => {
    startWorkspace({ kind: "local", name, files });
    const first = ["README.md"].find((p) => p in files) ?? Object.keys(files).sort()[0];
    if (first) { setTabs([{ id: `file:${first}`, kind: "file", path: first }]); setActiveTabId(`file:${first}`); }
  }, [startWorkspace]);
  const closeWorkspace = useCallback(() => resetWorkspaceState(), [resetWorkspaceState]);

  const requestAsk = useCallback((question: string, selection: Selection | null) => {
    nonce.current += 1;
    setAskRequest({ nonce: nonce.current, question, selection });
    setActiveRange(selection);
    setPendingSelection(null);
  }, []);

  const showInArchitecture = useCallback((ids: string[]) => { setHighlight(ids); openArch(); }, [openArch]);
  const openMemory = useCallback((id: string) => { setFocusMemoryId(id); openPage("memory"); }, [openPage]);
  const openRun = useCallback((id: string) => { setSelectedRunId(id); openPage("runs"); }, [openPage]);
  const openCompare = useCallback((p: { question: string; selection: Selection | null; repoId: string | null; groupId?: string | null }) => {
    nonce.current += 1;
    setComparePrefill({ nonce: nonce.current, ...p });
    openPage("compare");
  }, [openPage]);

  const can = useCallback((p: Permission) => !!me?.org.permissions.includes(p), [me]);
  const repo = workspace?.kind === "repo" ? repos.find((r) => r.id === workspace.repoId) ?? null : null;
  const group = workspace?.kind === "group" ? groups.find((g) => g.id === workspace.groupId) ?? null : null;
  const groupMembers = useMemo(() => groupRepos(group, repos), [group, repos]);

  const value = useMemo<AppState>(() => ({
    status, bootError, retryBoot: () => setBootTick((t) => t + 1), me, can, signedIn: afterSignIn, signOut, switchOrg, createOrg, notice, setNotice,
    pendingCount, refreshPending, integrations, refreshIntegrations, repos, reposLoading, reposError, refreshRepos: loadRepos, upsertRepo, removeRepoLocal,
    groups, groupsError, refreshGroups: loadGroups, upsertGroup, removeGroupLocal,
    workspace, repo, group, groupMembers, openRepo, openGroup, openLocal, closeWorkspace, settingsOpen, setSettingsOpen,
    tabs, activeTabId, setActiveTabId, openFile, openPage, openArch, closeTab, sidebar, setSidebar,
    memoryOn, setMemoryOn, pendingSelection, setPendingSelection, activeRange, setActiveRange, askRequest, requestAsk,
    highlight, setHighlight, showInArchitecture, selectedNode, setSelectedNode,
    focusMemoryId, clearFocusMemory: () => setFocusMemoryId(null), openMemory, selectedRunId, openRun, comparePrefill, openCompare,
  }), [status, bootError, me, can, afterSignIn, signOut, switchOrg, createOrg, notice, pendingCount, refreshPending, integrations, refreshIntegrations, repos, reposLoading, reposError, loadRepos,
    upsertRepo, removeRepoLocal, groups, groupsError, loadGroups, upsertGroup, removeGroupLocal, workspace, repo, group, groupMembers, openRepo, openGroup, openLocal, closeWorkspace, settingsOpen, tabs, activeTabId, openFile, openPage, openArch, closeTab, sidebar,
    memoryOn, pendingSelection, activeRange, askRequest, requestAsk, highlight, showInArchitecture, selectedNode, focusMemoryId, openMemory, selectedRunId, openRun,
    comparePrefill, openCompare]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
