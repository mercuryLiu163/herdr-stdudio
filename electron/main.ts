import { app, BrowserWindow, ipcMain, Notification } from "electron";
import * as path from "node:path";
import {
  HerdrClient,
  Subscription,
  socketDescription,
  launchHerdrServer,
  pointerExists,
} from "./herdr-client";

const client = new HerdrClient();

let win: BrowserWindow | null = null;

// Two long-lived event connections:
//   hub A — global workspace/tab/pane/agent state events
//   hub B — output stream for the currently viewed pane (swapped on selection)
let hubA: { subs: Subscription[]; sock: import("node:net").Socket } | null = null;
let hubB: { paneId: string; state: PaneStreamState } | null = null;
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

async function setPaneStream(paneId: string | null): Promise<void> {
  if (hubB) {
    const old = hubB;
    hubB = null;
    old.state.stop = true;
  }
  if (!paneId) return;
  const state: PaneStreamState = { paneId, lastText: "", stop: false };
  hubB = { paneId, state };
  void runPaneStream(state);
}

/**
 * Output stream for the viewed pane. `pane.output_matched` subscriptions turn
 * out to be one-shot (single push on first match), and `events.wait` does not
 * support output matches yet — so poll `pane.read` and forward on change.
 */
async function runPaneStream(state: PaneStreamState): Promise<void> {
  while (!state.stop && hubB?.state === state) {
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
      if (state.stop || hubB?.state !== state) break;
      const read = (res as { read?: { text?: string; revision?: number } }).read;
      if (read && typeof read.text === "string" && read.text !== state.lastText) {
        state.lastText = read.text;
        send("herdr:event", { event: "studio.pane_output", data: { read } });
      }
    } catch {
      // Pane closed or server restarting; loop on and pick up recovery.
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
  ipcMain.handle("herdr:set-pane-stream", async (_e, paneId: string | null) => {
    await setPaneStream(paneId);
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
  if (hubB) hubB.state.stop = true;
  app.quit();
});
