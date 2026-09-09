import { app, BrowserWindow, ipcMain, Notification, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  HerdrClient,
  Subscription,
  socketDescription,
  launchHerdrServer,
  pointerExists,
} from "./herdr-client";

const client = new HerdrClient();

// E2E isolation: test launches point HERDR_STUDIO_SOCKET at a throwaway
// session; give them a throwaway userData dir too so localStorage (theme,
// layout mode) starts from defaults on every launch instead of leaking
// between runs.
if (process.env.HERDR_STUDIO_SOCKET) {
  try {
    const tmp = app.getPath("temp");
    // Startup sweep: drop throwaway userData dirs left by runs older than 24h.
    // Never touches a dir still in use by a live instance (mtime is fresh).
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const name of fs.readdirSync(tmp)) {
        if (!name.startsWith("herdr-studio-e2e-")) continue;
        const full = path.join(tmp, name);
        try {
          if (fs.statSync(full).mtimeMs < cutoff) {
            fs.rmSync(full, { recursive: true, force: true });
          }
        } catch {
          /* in use or already gone */
        }
      }
    } catch {
      /* best effort */
    }
    app.setPath("userData", path.join(tmp, `herdr-studio-e2e-${Date.now()}-${process.pid}`));
  } catch {
    /* best effort */
  }
}

let win: BrowserWindow | null = null;

// Two long-lived event connections:
//   hub A — global workspace/tab/pane/agent state events
//   hub B — output stream for the currently viewed pane(s) (swapped on selection)
let hubA: { subs: Subscription[]; sock: import("node:net").Socket } | null = null;
let hubB: { states: PaneStreamState[] } | null = null;
let hubADownTimer: NodeJS.Timeout | null = null;

interface PaneStreamState {
  paneId: string;
  lastText: string;
  stop: boolean;
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function setStatus(status: string): void {
  send("herdr:status", status);
}

const GLOBAL_SUBSCRIPTIONS: Subscription[] = [
  { type: "workspace.created" },
  { type: "workspace.updated" },
  { type: "workspace.metadata_updated" },
  { type: "workspace.closed" },
  { type: "workspace.renamed" },
  { type: "workspace.reordered" },
  { type: "workspace.focused" },
  { type: "worktree.created" },
  { type: "worktree.opened" },
  { type: "worktree.removed" },
  { type: "tab.created" },
  { type: "tab.closed" },
  { type: "tab.focused" },
  { type: "tab.renamed" },
  { type: "tab.moved" },
  { type: "pane.created" },
  { type: "pane.closed" },
  { type: "pane.updated" },
  { type: "pane.focused" },
  { type: "pane.moved" },
  { type: "pane.exited" },
  { type: "pane.agent_detected" },
  { type: "layout.updated" },
];

let hubABackoff = 500;

async function openHubA(subs: Subscription[]): Promise<void> {
  if (hubADownTimer) {
    clearTimeout(hubADownTimer);
    hubADownTimer = null;
  }
  hubA = { subs, sock: null as unknown as import("node:net").Socket };
  hubABackoff = 500;
  await connectHubA();
}

async function connectHubA(): Promise<void> {
  if (!hubA) return;
  const cur = hubA;
  try {
    const sock = await client.openEventStream(
      cur.subs,
      (ev) => send("herdr:event", ev),
      () => {
        if (hubA === cur) {
          setStatus("reconnecting");
          hubADownTimer = setTimeout(() => void connectHubA(), hubABackoff);
          hubABackoff = Math.min(hubABackoff * 2, 8000);
        }
      },
    );
    cur.sock = sock;
    setStatus("connected");
    send("herdr:resync");
  } catch {
    if (hubA === cur) {
      const firstTry = hubABackoff === 500;
      setStatus(firstTry && !pointerExists() ? "no-server" : "reconnecting");
      hubADownTimer = setTimeout(() => void connectHubA(), hubABackoff);
      hubABackoff = Math.min(hubABackoff * 2, 8000);
    }
  }
}

let hubBBackoff = 400;

async function setPaneStream(panes: string | string[] | null): Promise<void> {
  if (hubB) {
    for (const s of hubB.states) s.stop = true;
    hubB = null;
  }
  const ids = Array.isArray(panes) ? panes : panes ? [panes] : [];
  if (!ids.length) return;
  const states: PaneStreamState[] = ids.map((paneId) => ({
    paneId,
    lastText: "",
    stop: false,
  }));
  hubB = { states };
  void runPaneStreams(states);
}

/**
 * Output stream for the viewed pane(s). `pane.output_matched` subscriptions
 * turn out to be one-shot (single push on first match), and `events.wait` does
 * not support output matches yet — so poll `pane.read` and forward on change.
 * Unified layout mode passes every pane of the active tab, so the mosaic can
 * render live output for all cells.
 */
async function runPaneStreams(states: PaneStreamState[]): Promise<void> {
  const alive = (state: PaneStreamState) =>
    hubB !== null && hubB.states.some((s) => s === state);
  while (hubB && states.some((s) => !s.stop)) {
    for (const state of states) {
      if (state.stop || !alive(state)) continue;
      try {
        const res = await client.rpc(
          "pane.read",
          {
            pane_id: state.paneId,
            source: "recent_unwrapped",
            lines: 400,
            format: "ansi",
            strip_ansi: false,
          },
          8000,
        );
        if (state.stop || !alive(state)) continue;
        const read = (res as { read?: { text?: string; revision?: number } }).read;
        if (read && typeof read.text === "string" && read.text !== state.lastText) {
          state.lastText = read.text;
          send("herdr:event", { event: "studio.pane_output", data: { read } });
        }
      } catch {
        // Pane closed or server restarting; loop on and pick up recovery.
      }
    }
    await sleepMs(600);
  }
}

/**
 * Agent-status watcher. Status transitions for background panes have no global
 * push channel (`pane.agent_status_changed` subscriptions are per-pane), so
 * poll `agent.list` and synthesize transition events for the renderer.
 */
let lastAgentStatus = new Map<string, string>();
let agentsObserved = false;

function startAgentStatusWatcher(): void {
  setInterval(() => {
    void (async () => {
      try {
        const res = await client.rpc("agent.list", {}, 8000);
        const agents = (res as { agents?: Array<{ pane_id: string; agent_status: string }> })
          .agents ?? [];
        const seen = new Set<string>();
        for (const a of agents) {
          seen.add(a.pane_id);
          const prev = lastAgentStatus.get(a.pane_id);
          // Notify on any observed transition; a brand-new agent that already
          // sits in blocked/done also warrants a notification (its earlier
          // states were simply never observed by this poller).
          const firstSeenNeedsNotice =
            prev === undefined && (a.agent_status === "blocked" || a.agent_status === "done");
          if (agentsObserved && (firstSeenNeedsNotice || (prev !== undefined && prev !== a.agent_status))) {
            send("herdr:event", {
              event: "pane_agent_status_changed",
              data: { pane_id: a.pane_id, agent_status: a.agent_status },
            });
          }
          lastAgentStatus.set(a.pane_id, a.agent_status);
        }
        for (const gone of [...lastAgentStatus.keys()]) {
          if (!seen.has(gone)) lastAgentStatus.delete(gone);
        }
        agentsObserved = true;
      } catch {
        /* server down; retry next tick */
      }
    })();
  }, 3000);
}

function registerIpc(): void {
  ipcMain.handle(
    "herdr:invoke",
    async (_e, method: string, params: unknown, timeoutMs?: number) => {
      return client.rpc(method, params, timeoutMs);
    },
  );
  ipcMain.handle("herdr:set-global-subs", async (_e, subs: Subscription[]) => {
    await openHubA(subs.length ? subs : GLOBAL_SUBSCRIPTIONS);
  });
  ipcMain.handle("herdr:set-pane-stream", async (_e, panes: string | string[] | null) => {
    await setPaneStream(panes);
  });
  ipcMain.handle("herdr:socket-info", () => socketDescription());
  ipcMain.handle("herdr:notify", (_e, opts: { title: string; body: string }) => {
    // Test seam: record notifications to a JSONL file when running E2E tests.
    const testLog = process.env.HERDR_STUDIO_TEST_LOG;
    if (testLog) {
      try {
        require("node:fs").appendFileSync(
          testLog,
          JSON.stringify({ title: opts.title, body: opts.body, at: Date.now() }) + "\n",
        );
      } catch {
        /* best effort */
      }
    }
    if (Notification.isSupported()) {
      new Notification({ title: opts.title, body: opts.body, silent: false }).show();
    }
  });
  ipcMain.handle("herdr:launch-server", async () => {
    launchHerdrServer();
  });
  ipcMain.handle("herdr:win", (e, action: "min" | "max" | "close") => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (action === "min") w.minimize();
    else if (action === "max") (w.isMaximized() ? w.unmaximize() : w.maximize());
    else w.close();
  });

  // ---- F2: right tool sidebar (local file tree / preview / open) ----
  ipcMain.handle("fs:tree", (_e, dir: string, depth?: number) => {
    try {
      // Root readability check — surface a real error state instead of an
      // empty-looking tree. Per-subdirectory failures still degrade to [].
      fs.readdirSync(dir, { withFileTypes: true });
      return buildFileTree(dir, typeof depth === "number" ? depth : 3);
    } catch (err: any) {
      return { error: String(err?.message ?? err) };
    }
  });
  ipcMain.handle("fs:read", (_e, p: string) => readFilePreview(p));
  ipcMain.handle("fs:open", async (_e, p: string) => {
    return shell.openPath(p);
  });
}

// ---------- F2 local file access ----------
//
// Local developer tool: paths are NOT sandboxed, the renderer only ever shows
// entries that came from the tree rooted at a pane cwd.

export interface FsNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: FsNode[];
}

const FS_SKIP_DIRS = new Set(["node_modules", ".git"]);
const FS_MAX_ENTRIES = 500;
const FS_MAX_TEXT_BYTES = 512 * 1024;
const FS_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const IMAGE_EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/** Extensions we preview as text; anything unknown is "other" (open externally). */
const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonc", ".js", ".mjs", ".cjs", ".ts",
  ".tsx", ".jsx", ".css", ".scss", ".less", ".html", ".htm", ".xml", ".yml",
  ".yaml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bash", ".ps1", ".psm1",
  ".py", ".rb", ".php", ".sql", ".rs", ".go", ".java", ".kt", ".c", ".h",
  ".cpp", ".hpp", ".cs", ".m", ".swift", ".log", ".csv", ".tsv", ".env",
  ".lock", ".gitignore", ".gitattributes", ".editorconfig", ".prd", ".map",
]);

function buildFileTree(dir: string, depth: number): FsNode[] {
  const walk = (d: string, level: number): FsNode[] => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    const out: FsNode[] = [];
    for (const entry of entries) {
      if (out.length >= FS_MAX_ENTRIES) break;
      if (entry.name.startsWith(".")) continue; // hidden
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (FS_SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        out.push({
          name: entry.name,
          path: full,
          type: "dir",
          children: level < depth ? walk(full, level + 1) : [],
        });
      } else if (entry.isFile()) {
        out.push({ name: entry.name, path: full, type: "file" });
      }
    }
    return out;
  };
  return walk(dir, 1);
}

export type FilePreview =
  | { kind: "text"; data: string; path: string }
  | { kind: "image"; data: string; path: string }
  | { kind: "other"; data: string; path: string };

function readFilePreview(p: string): FilePreview {
  const ext = path.extname(p).toLowerCase();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return { kind: "other", data: p, path: p };
  }
  const mime = IMAGE_EXT_MIME[ext];
  if (mime && stat.isFile() && stat.size <= FS_MAX_IMAGE_BYTES) {
    try {
      const b64 = fs.readFileSync(p).toString("base64");
      return { kind: "image", data: `data:${mime};base64,${b64}`, path: p };
    } catch {
      return { kind: "other", data: p, path: p };
    }
  }
  if (TEXT_EXT.has(ext) && stat.isFile() && stat.size <= FS_MAX_TEXT_BYTES) {
    try {
      return { kind: "text", data: fs.readFileSync(p, "utf8"), path: p };
    } catch {
      /* fall through */
    }
  }
  return { kind: "other", data: p, path: p };
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    frame: false,
    backgroundColor: "#262624",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Register before loadURL: in dev the page can paint while loadURL is still
  // awaiting, and a late listener would miss ready-to-show — window never shows.
  win.once("ready-to-show", () => win?.show());

  // Navigation guard: the window only ever shows the app bundle. Anything else
  // (window.open or top-level navigation to a remote/file URL) is denied and,
  // for http(s), handed to the system browser instead.
  const isAppUrl = (url: string) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) return url.startsWith(devUrl);
    return url.startsWith("file://");
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await win.loadURL(devUrl).catch(() => {});
  } else {
    await win.loadFile(path.join(__dirname, "..", "dist-renderer", "index.html"));
  }
  // Belt and braces: if ready-to-show never fired (slow first paint), show anyway.
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show();
  }, 1500);

  // Debug hook: `electron . --screenshot=<path> [--exit]` captures the UI
  // once the renderer reports it is ready with data.
  const screenshotArg = process.argv.find((a) => a.startsWith("--screenshot="));
  if (screenshotArg) {
    const outPath = screenshotArg.slice("--screenshot=".length);
    win.show();
    const capture = async () => {
      try {
        const img = await win!.webContents.capturePage();
        const png = img.toPNG();
        require("node:fs").writeFileSync(outPath, png);
        console.log("[screenshot] wrote " + outPath);
      } catch (err) {
        console.error("[screenshot] failed", err);
      }
      if (process.argv.includes("--exit")) app.quit();
    };
    const trigger = new Promise<void>((resolve) => {
      ipcMain.once("herdr:ui-ready", () => resolve());
    });
    const fallback = new Promise<void>((r) => setTimeout(r, 12000));
    void Promise.race([trigger, fallback]).then(() => setTimeout(capture, 900));
  }

  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(async () => {
  registerIpc();
  startAgentStatusWatcher();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (hubA) hubA.sock.destroy();
  if (hubB) for (const s of hubB.states) s.stop = true;
  app.quit();
});
