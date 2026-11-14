"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { runAgent } from "@/lib/agent";
import { SCENARIOS, SEED_EVENTS, SEED_MEMORIES, USERS } from "@/lib/mock";
import { buildAsk, buildWhy } from "@/lib/why";
import { api, evidenceFrom, finalFrom, liveAsk, loadUsers, login, memoryActions, memoryAgentFrom } from "@/lib/live";
import type { AuditEvent, Memory, Run, Selection, Tab, ThreadItem, User, ViewId, Workspace } from "@/lib/types";

export type SidebarPanel = "files" | "arch" | "gov";

interface AppState {
  user: User;
  setUserId: (id: string) => void;

  workspace: Workspace | null;
  openWorkspace: (w: Workspace) => void;
  closeWorkspace: () => void;

  tabs: Tab[];
  activeTabId: string | null;
  setActiveTabId: (id: string) => void;
  openFile: (path: string) => void;
  openPage: (page: ViewId) => void;
  closeTab: (id: string) => void;
  /** Compatibility shim: old screens call setView("memory") etc. */
  setView: (v: ViewId) => void;

  sidebar: SidebarPanel;
  setSidebar: (p: SidebarPanel) => void;

  memoryOn: boolean;
  setMemoryOn: (b: boolean) => void;
  pendingSelection: Selection | null;
  setPendingSelection: (s: Selection | null) => void;
  activeRange: Selection | null;
  thread: ThreadItem[];
  ask: (question: string, sel?: Selection | null) => Promise<string | null>; // resolves to a note when it can't answer
  busy: boolean;
  /** true when the FastAPI backend (Atlas + Voyage + Gemini) is reachable; false = offline preview on mock data */
  live: boolean;
  users: User[];
  refresh: () => Promise<void>;
  /** Governance actions. Live: enforced server-side. Offline preview: return false and the view applies its local fallback. */
  gov: {
    approve: (id: string, content?: string) => Promise<boolean>;
    reject: (id: string) => Promise<boolean>;
    correct: (id: string, content: string, note: string) => Promise<boolean>;
    revoke: (id: string, reason: string) => Promise<boolean>;
    propose: (title: string, content: string, components: string[], runId: string) => Promise<boolean>;
  };
  govError: string | null;

  memories: Memory[];
  updateMemory: (id: string, fn: (m: Memory) => Memory) => void;
  addMemory: (m: Memory) => void;
  events: AuditEvent[];
  log: (e: Omit<AuditEvent, "id" | "at">) => void;
  runs: Run[];
  addRun: (r: Run) => void;
  selectedRunId: string | null;
  setSelectedRunId: (id: string | null) => void;
  selectedNode: string | null;
  setSelectedNode: (id: string | null) => void;
  highlight: string[];
  setHighlight: (ids: string[]) => void;
  focusMemoryId: string | null;
  setFocusMemoryId: (id: string | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

const nowLabel = () => {
  const d = new Date();
  return `${d.toISOString().slice(0, 10)} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};

const PAGE_TITLES: Record<string, string> = { memory: "Memory Inspector", approvals: "Approval Center", history: "Decision History", runs: "Run Inspector", compare: "Memory Impact" };
export const pageTitle = (p: ViewId) => PAGE_TITLES[p] ?? p;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState("alice");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<SidebarPanel>("files");
  const [memoryOn, setMemoryOn] = useState(true);
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(null);
  const [activeRange, setActiveRange] = useState<Selection | null>(null);
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [memories, setMemories] = useState<Memory[]>(SEED_MEMORIES);
  const [events, setEvents] = useState<AuditEvent[]>(SEED_EVENTS);
  const [runs, setRuns] = useState<Run[]>(() => [runAgent(SCENARIOS[0], true, USERS[0], SEED_MEMORIES), runAgent(SCENARIOS[0], false, USERS[0], SEED_MEMORIES)]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [focusMemoryId, setFocusMemoryId] = useState<string | null>(null);

  const [live, setLive] = useState(false);
  const [users, setUsers] = useState<User[]>(USERS);
  const [busy, setBusy] = useState(false);
  const [govError, setGovError] = useState<string | null>(null);
  const user = users.find((u) => u.id === userId) ?? users[0] ?? USERS[0];

  const refresh = useCallback(async () => {
    const [ms, rs, es] = await Promise.all([api<Memory[]>("/arch/memories"), api<Run[]>("/arch/runs"), api<AuditEvent[]>("/arch/events")]);
    setMemories(ms); setRuns(rs); setEvents(es);
  }, []);

  // Sign in to the backend as the selected demo user; fall back to the offline preview if it is unreachable.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const us = await loadUsers();
        await login(userId);
        if (cancelled) return;
        setUsers(us); setLive(true); setThread([]);
        await refresh();
      } catch {
        if (!cancelled) setLive(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, refresh]);

  const govCall = useCallback(async (fn: () => Promise<unknown>) => {
    if (!live) return false;
    setGovError(null);
    try { await fn(); await refresh(); } catch (e) { setGovError((e as Error).message); }
    return true;
  }, [live, refresh]);
  const gov = useMemo(() => ({
    approve: (id: string, content?: string) => govCall(() => memoryActions.approve(id, content)),
    reject: (id: string) => govCall(() => memoryActions.reject(id)),
    correct: (id: string, content: string, note: string) => govCall(() => memoryActions.correct(id, content, note)),
    revoke: (id: string, reason: string) => govCall(() => memoryActions.revoke(id, reason)),
    propose: (title: string, content: string, components: string[], runId: string) => govCall(() => memoryActions.propose(title, content, components, runId)),
  }), [govCall]);

  const focusTab = useCallback((t: Tab) => {
    setTabs((ts) => (ts.some((x) => x.id === t.id) ? ts : [...ts, t]));
    setActiveTabId(t.id);
  }, []);

  const openFile = useCallback((path: string) => focusTab({ id: `file:${path}`, kind: "file", path }), [focusTab]);
  const openPage = useCallback((page: ViewId) => focusTab(page === "explorer" ? { id: "arch", kind: "arch" } : { id: `page:${page}`, kind: "page", page }), [focusTab]);
  const setView = useCallback((v: ViewId) => { if (v !== "assistant") openPage(v); }, [openPage]);

  const closeTab = useCallback((id: string) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      setActiveTabId((cur) => (cur === id ? next[Math.min(i, next.length - 1)]?.id ?? null : cur));
      return next;
    });
  }, []);

  const openWorkspace = useCallback((w: Workspace) => {
    setWorkspace(w);
    setThread([]);
    setActiveRange(null);
    setPendingSelection(null);
    const first = ["services/auth/src/validate.ts", "README.md"].find((p) => p in w.files) ?? Object.keys(w.files).sort()[0];
    const t: Tab[] = [];
    if (first) t.push({ id: `file:${first}`, kind: "file", path: first });
    setTabs(t);
    setActiveTabId(t[0]?.id ?? null);
    setSidebar("files");
  }, []);

  const closeWorkspace = useCallback(() => { setWorkspace(null); setTabs([]); setActiveTabId(null); setThread([]); setActiveRange(null); }, []);

  const updateMemory = useCallback((id: string, fn: (m: Memory) => Memory) => setMemories((ms) => ms.map((m) => (m.id === id ? fn(m) : m))), []);
  const addMemory = useCallback((m: Memory) => setMemories((ms) => [m, ...ms]), []);
  const log = useCallback((e: Omit<AuditEvent, "id" | "at">) => setEvents((es) => [{ ...e, id: `e${es.length + 1}_${Date.now()}`, at: nowLabel() }, ...es]), []);
  const addRun = useCallback((r: Run) => setRuns((rs) => [r, ...rs]), []);

  const ask = useCallback(async (question: string, sel?: Selection | null) => {
    // Simulated GitHub / Jira / Confluence sub-agents (synthetic demo repository).
    const built = sel ? buildWhy(sel, question, user, memories, memoryOn) : buildAsk(question, user, memories, memoryOn);
    if (!live) {
      if (!built) return "The preview answers two scripted architecture questions (Redis caching, token validation in the gateway). Select code in the editor to ask why it exists.";
      setThread((t) => [...t, built.item]);
      setRuns((rs) => [built.run, ...rs]);
      setHighlight(built.item.final.affected);
      setActiveRange(sel ?? null);
      setPendingSelection(null);
      log({ type: "agent.decision", actor: user.name, detail: `${built.run.id}: ${built.item.final.decision} (${built.item.final.memoryRefs.length ? "memory-informed" : "no memory influence"})` });
      return null;
    }
    // Live: real governed retrieval (Atlas $vectorSearch) + real reasoning model, recorded server-side.
    const simAgents = built
      ? built.item.agents.filter((a) => a.id !== "memory")
      : (["github", "jira", "confluence"] as const).map((id) => ({ id, label: `${id[0].toUpperCase()}${id.slice(1)} agent`, tools: ["integration simulated for the demo repository only"], durationMs: 400, findings: [], summary: "No simulated evidence for this question." }));
    setBusy(true);
    try {
      const run = await liveAsk(question, memoryOn, evidenceFrom(simAgents), sel);
      const final = finalFrom(run);
      const item: ThreadItem = { id: `live_${run.id}`, startedAt: Date.now(), question, selection: sel ?? undefined,
        agents: [...simAgents, memoryAgentFrom(run, memoryOn)], final, runId: run.id };
      setThread((t) => [...t, item]);
      setHighlight(final.affected);
      setActiveRange(sel ?? null);
      setPendingSelection(null);
      await refresh();
      return null;
    } catch (e) {
      return `Agent run failed: ${(e as Error).message}`;
    } finally {
      setBusy(false);
    }
  }, [user, memories, memoryOn, log, live, refresh]);

  const value = useMemo<AppState>(() => ({
    user, setUserId, workspace, openWorkspace, closeWorkspace, tabs, activeTabId, setActiveTabId, openFile, openPage, closeTab, setView,
    sidebar, setSidebar, memoryOn, setMemoryOn, pendingSelection, setPendingSelection, activeRange, thread, ask, busy, live, users, refresh, gov, govError,
    memories, updateMemory, addMemory, events, log, runs, addRun, selectedRunId, setSelectedRunId, selectedNode, setSelectedNode, highlight, setHighlight, focusMemoryId, setFocusMemoryId,
  }), [user, workspace, openWorkspace, closeWorkspace, tabs, activeTabId, openFile, openPage, closeTab, setView, sidebar, memoryOn, pendingSelection, activeRange, thread, ask, busy, live, users, refresh, gov, govError,
    memories, updateMemory, addMemory, events, log, runs, addRun, selectedRunId, selectedNode, highlight, focusMemoryId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
