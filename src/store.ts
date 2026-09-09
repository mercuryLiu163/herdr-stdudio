import { create } from "zustand";
import type {
  AgentInfo,
  AgentStatus,
  ConnStatus,
  PaneInfo,
  PushEvent,
  Snapshot,
  TabInfo,
  WorkspaceInfo,
} from "./types";
import * as api from "./api";

export interface OutputState {
  text: string;
  revision: number;
  updatedAt: number;
  loading: boolean;
  failed?: boolean;
}

export interface Toast {
  id: number;
  kind: "error" | "info";
  message: string;
}

export type LayoutMode = "separate" | "unified";

const LAYOUT_KEY = "herdr-studio-layout-mode";

function readStoredLayoutMode(): LayoutMode {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "unified" ? "unified" : "separate";
  } catch {
    return "separate";
  }
}

interface StudioState {
  status: ConnStatus;
  socket: { pointer: string; target: string } | null;
  snapshot: Snapshot | null;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  agents: AgentInfo[];

  activeWorkspaceId: string | null;
  activeTabId: string | null;
  activePaneId: string | null;

  outputs: Record<string, OutputState>;
  toasts: Toast[];

  /** F3: terminal area layout mode. */
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  /** F2: right tool sidebar visibility. */
  rightSidebarOpen: boolean;
  toggleRightSidebar: () => void;
  /** Point the main-process output stream at the pane(s) the user is watching. */
  syncPaneStream: () => void;

  booted: boolean;

  boot: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  selectWorkspace: (id: string) => void;
  selectTab: (id: string) => void;
  selectPane: (id: string) => void;
  refreshPaneOutput: (paneId: string) => Promise<void>;
  applyPush: (ev: PushEvent) => void;
  pushToast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
  launchServer: () => Promise<void>;
}

let toastSeq = 1;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
/** Last pane id set handed to the main-process stream (dedup for syncPaneStream). */
let lastStreamKey: string | null = null;

const GLOBAL_SUBS = [
  "workspace.created",
  "workspace.updated",
  "workspace.metadata_updated",
  "workspace.closed",
  "workspace.renamed",
  "workspace.reordered",
  "workspace.focused",
  "worktree.created",
  "worktree.opened",
  "worktree.removed",
  "tab.created",
  "tab.closed",
  "tab.focused",
  "tab.renamed",
  "tab.moved",
  "pane.created",
  "pane.closed",
  "pane.updated",
  "pane.focused",
  "pane.moved",
  "pane.exited",
  "pane.agent_detected",
  "layout.updated",
].map((type) => ({ type }));

/** Debounced full-snapshot refetch — herdr state events are cheap to re-read. */
function scheduleSnapshotRefresh(get: () => StudioState) {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    void get().refreshSnapshot();
  }, 120);
}

const STATE_EVENTS = new Set([
  "workspace_created",
  "workspace_updated",
  "workspace_metadata_updated",
  "workspace_closed",
  "workspace_renamed",
  "workspace_reordered",
  "workspace_focused",
  "worktree_created",
  "worktree_opened",
  "worktree_removed",
  "tab_created",
  "tab_closed",
  "tab_renamed",
  "tab_moved",
  "tab_focused",
  "pane_created",
  "pane_closed",
  "pane_updated",
  "pane_focused",
  "pane_moved",
  "pane_exited",
  "pane_agent_detected",
  "layout_updated",
  // NOTE: pane_agent_status_changed is handled by its own branch below — it
  // must trigger both a snapshot refresh AND blocked/done notifications.
]);

export const useStore = create<StudioState>((set, get) => ({
  status: "connecting",
  socket: null,
  snapshot: null,
  workspaces: [],
  tabs: [],
  panes: [],
  agents: [],

  activeWorkspaceId: null,
  activeTabId: null,
  activePaneId: null,

  outputs: {},
  toasts: [],

  layoutMode: readStoredLayoutMode(),
  rightSidebarOpen: false,

  booted: false,

  setLayoutMode: (mode) => {
    set({ layoutMode: mode });
    try {
      localStorage.setItem(LAYOUT_KEY, mode);
    } catch {
      /* non-fatal */
    }
    // Unified mode streams every pane of the active tab; separate follows one.
    get().syncPaneStream();
    if (mode === "unified") {
      const { panes, activeTabId } = get();
      for (const p of panes) {
        if (p.tab_id === activeTabId) void get().refreshPaneOutput(p.pane_id);
      }
    }
  },

  toggleRightSidebar: () => {
    set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen }));
  },

  boot: async () => {
    try {
      const socket = await window.herdr.socketInfo();
      set({ socket });
    } catch {
      /* non-fatal */
    }

    window.herdr.onStatus((status) => {
      set({ status });
      if (status === "connected") void get().refreshSnapshot();
    });
    window.herdr.onEvent((ev) => get().applyPush(ev));
    window.herdr.onResync(() => void get().refreshSnapshot());

    await window.herdr.setGlobalSubs(GLOBAL_SUBS);
    await get().refreshSnapshot();
    set({ booted: true });
    window.herdr.signalUiReady();
  },

  refreshSnapshot: async () => {
    try {
      const { snapshot: snap } = await api.snapshot();
      const s = snap;
      set({
        snapshot: s,
        status: "connected",
        workspaces: s.workspaces ?? [],
        tabs: s.tabs ?? [],
        panes: s.panes ?? [],
        agents: s.agents ?? [],
      });

      // Keep a sensible selection without fighting the user's explicit choice.
      const st = get();
      const wsStillThere =
        st.activeWorkspaceId && s.workspaces?.some((w) => w.workspace_id === st.activeWorkspaceId);
      const wsId = wsStillThere ? st.activeWorkspaceId : s.focused_workspace_id ?? s.workspaces?.[0]?.workspace_id ?? null;
      const tabsOfWs = (s.tabs ?? []).filter((t) => t.workspace_id === wsId);
      const tabStillThere =
        st.activeTabId && tabsOfWs.some((t) => t.tab_id === st.activeTabId);
      const tabId = tabStillThere ? st.activeTabId : tabsOfWs.find((t) => t.focused)?.tab_id ?? tabsOfWs[0]?.tab_id ?? null;
      const panesOfTab = (s.panes ?? []).filter((p) => p.tab_id === tabId);
      const paneStillThere =
        st.activePaneId && panesOfTab.some((p) => p.pane_id === st.activePaneId);
      const paneId = paneStillThere ? st.activePaneId : panesOfTab.find((p) => p.focused)?.pane_id ?? panesOfTab[0]?.pane_id ?? null;

      if (
        wsId !== st.activeWorkspaceId ||
        tabId !== st.activeTabId ||
        paneId !== st.activePaneId
      ) {
        set({ activeWorkspaceId: wsId, activeTabId: tabId, activePaneId: paneId });
      }
      const finalPaneId = paneId;
      if (finalPaneId) void get().refreshPaneOutput(finalPaneId);
      // Keep the unified-mode stream set current with pane create/close events
      // (no-op when the id set didn't change).
      get().syncPaneStream();
    } catch (err: any) {
      if (get().status !== "reconnecting") {
        set({ status: "no-server" });
      }
    }
  },

  selectWorkspace: (id) => {
    set({ activeWorkspaceId: id });
    const tabs = get().tabs.filter((t) => t.workspace_id === id);
    const tabId = tabs.find((t) => t.focused)?.tab_id ?? tabs[0]?.tab_id ?? null;
    if (tabId) get().selectTab(tabId);
    else set({ activeTabId: null, activePaneId: null });
  },

  selectTab: (id) => {
    const tab = get().tabs.find((t) => t.tab_id === id);
    const panes = get().panes.filter((p) => p.tab_id === id);
    const paneId = panes.find((p) => p.focused)?.pane_id ?? panes[0]?.pane_id ?? null;
    set({ activeTabId: id, activeWorkspaceId: tab?.workspace_id ?? get().activeWorkspaceId });
    if (paneId) get().selectPane(paneId);
    else {
      set({ activePaneId: null });
      void window.herdr.setPaneStream(null);
    }
  },

  selectPane: (id) => {
    set({ activePaneId: id });
    get().syncPaneStream();
    void get().refreshPaneOutput(id);
  },

  /**
   * Separate mode follows only the active pane; unified mode follows every
   * pane of the active tab so the mosaic shows live output everywhere. Called
   * on selection changes AND after every snapshot refresh (so pane_created /
   * pane_closed events keep the unified stream set current). Deduplicated by
   * the requested id set so repeated calls don't tear down the stream loop.
   */
  syncPaneStream: () => {
    const { layoutMode, panes, activeTabId, activePaneId } = get();
    let ids: string | string[] | null;
    if (layoutMode === "unified" && activeTabId) {
      const list = panes.filter((p) => p.tab_id === activeTabId).map((p) => p.pane_id);
      ids = list.length ? list : activePaneId;
    } else {
      ids = activePaneId;
    }
    const key = JSON.stringify(ids ?? null);
    if (key === lastStreamKey) return;
    lastStreamKey = key;
    void window.herdr.setPaneStream(ids);
  },

  refreshPaneOutput: async (paneId) => {
    set((s) => ({
      outputs: {
        ...s.outputs,
        [paneId]: s.outputs[paneId]
          ? { ...s.outputs[paneId], loading: true }
          : { text: "", revision: -1, updatedAt: 0, loading: true },
      },
    }));
    try {
      const { read } = await api.paneRead(paneId);
      set((s) => {
        const prev = s.outputs[paneId];
        if (prev && prev.revision > read.revision && !prev.loading) return s;
        return {
          outputs: {
            ...s.outputs,
            [paneId]: {
              text: read.text,
              revision: read.revision,
              updatedAt: Date.now(),
              loading: false,
            },
          },
        };
      });
    } catch {
      set((s) => ({
        outputs: {
          ...s.outputs,
          [paneId]: { text: "", revision: -1, updatedAt: Date.now(), loading: false, failed: true },
        },
      }));
    }
  },

  applyPush: (ev) => {
    const st = get();
    if (STATE_EVENTS.has(ev.event)) {
      scheduleSnapshotRefresh(get);
      return;
    }
    if (ev.event === "studio.pane_output" || ev.event === "pane.output_matched") {
      const read = ev.data?.read;
      if (!read?.pane_id) return;
      // Only the watched pane(s) are streamed; ignore stale pushes.
      const st = get();
      const unifiedPane =
        st.layoutMode === "unified" &&
        st.panes.some((p) => p.pane_id === read.pane_id && p.tab_id === st.activeTabId);
      if (read.pane_id !== st.activePaneId && !unifiedPane) return;
      set((s) => {
        const prev = s.outputs[read.pane_id];
        if (prev && prev.revision > read.revision) return s;
        return {
          outputs: {
            ...s.outputs,
            [read.pane_id]: {
              text: read.text,
              revision: read.revision,
              updatedAt: Date.now(),
              loading: false,
            },
          },
        };
      });
      return;
    }
    if (ev.event === "pane_agent_status_changed") {
      scheduleSnapshotRefresh(get);
      const nextStatus: AgentStatus | undefined = ev.data?.agent_status ?? ev.data?.status;
      const paneId: string | undefined = ev.data?.pane_id;
      if (paneId && nextStatus && (nextStatus === "blocked" || nextStatus === "done")) {
        const agent = st.agents.find((a) => a.pane_id === paneId);
        const label = agentDisplayName(agent) || paneId;
        void window.herdr.notify(
          nextStatus === "blocked" ? `${label} 需要你的确认` : `${label} 已完成`,
          nextStatus === "blocked" ? "Agent 遇到审批或提问，等待输入。" : "Agent 后台任务已结束。",
        );
      }
      return;
    }
  },

  pushToast: (kind, message) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), 4200);
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  launchServer: async () => {
    await window.herdr.launchServer();
    get().pushToast("info", "正在启动 herdr server…");
  },
}));

/** Agent record for a pane, if any. */
export function agentForPane(agents: AgentInfo[], paneId: string | null): AgentInfo | null {
  if (!paneId) return null;
  return agents.find((a) => a.pane_id === paneId) ?? null;
}

/** User-facing agent name with graceful fallbacks (name is often unset). */
export function agentDisplayName(agent: AgentInfo | null | undefined): string {
  if (!agent) return "";
  return (
    agent.name ||
    agent.terminal_title_stripped ||
    agent.terminal_title ||
    `${agent.agent} agent`
  );
}
