export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface WorkspaceInfo {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  tab_count: number;
  active_tab_id: string | null;
  agent_status: AgentStatus | null;
}

export interface TabInfo {
  tab_id: string;
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  pane_count: number;
  agent_status: AgentStatus | null;
}

export interface PaneInfo {
  pane_id: string;
  terminal_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  cwd: string;
  agent_status: AgentStatus | null;
  scroll?: unknown;
  revision?: number;
}

export interface AgentInfo {
  terminal_id: string;
  name: string;
  agent: string;
  terminal_title: string;
  terminal_title_stripped: string;
  agent_status: AgentStatus;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  focused: boolean;
  state_change_seq?: number;
  cwd: string;
  revision?: number;
}

export interface Snapshot {
  version: string;
  protocol: number;
  focused_workspace_id: string | null;
  focused_tab_id: string | null;
  focused_pane_id: string | null;
  workspaces: WorkspaceInfo[];
  tabs: TabInfo[];
  panes: PaneInfo[];
  layouts: unknown[];
  agents: AgentInfo[];
}

export interface PaneReadResult {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  source: string;
  format: string;
  text: string;
  revision: number;
  truncated: boolean;
}

export interface PushEvent {
  event: string;
  data: any;
}

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "no-server";

declare global {
  interface Window {
    herdr: {
      invoke: (
        method: string,
        params?: unknown,
        timeoutMs?: number,
      ) => Promise<{ type: string } & Record<string, unknown>>;
      setGlobalSubs: (subs: unknown[]) => Promise<void>;
      setPaneStream: (paneId: string | null) => Promise<void>;
      socketInfo: () => Promise<{ pointer: string; target: string }>;
      notify: (title: string, body: string) => Promise<void>;
      launchServer: () => Promise<void>;
      win: (action: "min" | "max" | "close") => Promise<void>;
      onEvent: (cb: (ev: PushEvent) => void) => () => void;
      onStatus: (cb: (status: ConnStatus) => void) => () => void;
      onResync: (cb: () => void) => () => void;
      signalUiReady: () => void;
    };
  }
}
