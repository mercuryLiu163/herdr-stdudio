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

/** F2: a node of the local file tree shown in the right sidebar. */
export interface FsNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: FsNode[];
}

/** F2: result of reading a file for preview. */
export type FilePreview =
  | { kind: "text"; data: string; path: string }
  | { kind: "image"; data: string; path: string }
  | { kind: "other"; data: string; path: string };

/** V5 F2: one `XY path` row of `git status --porcelain=v1 -b`. */
export interface GitStatusEntry {
  /** index (staged) status letter, " " when none */
  x: string;
  /** worktree status letter, " " when none */
  y: string;
  /** repo-relative path (rename arrow resolved to the new path) */
  path: string;
}

/**
 * V5 F2: result of the directory-scoped git status. A directory is a
 * "repository" only when it is the repo root itself (it owns the `.git`
 * marker); anything else reports `notRepo` instead of an inherited status.
 */
export type GitStatus =
  | { notRepo: true }
  | { notRepo?: false; branch: string; entries: GitStatusEntry[] };

/** F3: one pane's rectangle from the herdr layout snapshot (character cells). */
export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaneLayoutEntry {
  pane_id: string;
  focused: boolean;
  rect: PaneRect;
}

export interface PaneLayout {
  workspace_id: string;
  tab_id: string;
  zoomed: boolean;
  area: PaneRect;
  focused_pane_id: string | null;
  panes: PaneLayoutEntry[];
  splits?: Array<{ id: string; direction: string; ratio: number; rect: PaneRect }>;
}

declare global {
  interface Window {
    herdr: {
      invoke: (
        method: string,
        params?: unknown,
        timeoutMs?: number,
      ) => Promise<{ type: string } & Record<string, unknown>>;
      setGlobalSubs: (subs: unknown[]) => Promise<void>;
      setPaneStream: (panes: string | string[] | null) => Promise<void>;
      socketInfo: () => Promise<{ pointer: string; target: string }>;
      notify: (title: string, body: string) => Promise<void>;
      launchServer: () => Promise<void>;
      win: (action: "min" | "max" | "close") => Promise<void>;
      fsTree: (dir: string, depth?: number) => Promise<FsNode[] | { error: string }>;
      fsRead: (path: string) => Promise<FilePreview>;
      fsOpen: (path: string) => Promise<string>;
      pathForFile: (file: File) => string;
      fsSaveTemp: (payload: { data: string; name?: string }) => Promise<string>;
      gitStatus: (cwd: string) => Promise<GitStatus>;
      gitDiff: (cwd: string, path: string) => Promise<{ diff: string }>;
      onEvent: (cb: (ev: PushEvent) => void) => () => void;
      onStatus: (cb: (status: ConnStatus) => void) => () => void;
      onResync: (cb: () => void) => () => void;
      signalUiReady: () => void;
    };
  }
}
