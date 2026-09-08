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
let hubB: { paneId: string; sock: import("node:net").Socket } | null = null;
let hubADownTimer: NodeJS.Timeout | null = null;

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
    old.sock.destroy();
  }
  if (!paneId) return;
  hubBBackoff = 400;
  await connectHubB(paneId);
}

async function connectHubB(paneId: string): Promise<void> {
  const cur = hubB;
  if (cur && cur.paneId !== paneId) return;
  try {
    const sock = await client.openEventStream(
      [
        {
          type: "pane.output_matched",
          pane_id: paneId,
          source: "recent_unwrapped",
          lines: 400,
          strip_ansi: false,
          match: { type: "regex", value: "" },
        },
      ],
      (ev) => send("herdr:event", ev),
      () => {
        if (hubB && hubB.paneId === paneId) {
          hubBBackoff = Math.min(hubBBackoff * 2, 8000);
          setTimeout(() => void connectHubB(paneId), hubBBackoff);
        }
      },
    );
    hubB = { paneId, sock };
  } catch {
    // Pane may have been closed; renderer will re-call setPaneStream if needed.
  }
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

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(path.join(__dirname, "..", "dist-renderer", "index.html"));
  }

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

  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (hubA) hubA.sock.destroy();
  if (hubB) hubB.sock.destroy();
  app.quit();
});
