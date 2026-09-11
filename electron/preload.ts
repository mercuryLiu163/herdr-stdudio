import { contextBridge, ipcRenderer } from "electron";

const api = {
  invoke: (method: string, params: unknown, timeoutMs?: number) =>
    ipcRenderer.invoke("herdr:invoke", method, params, timeoutMs),
  setGlobalSubs: (subs: unknown[]) =>
    ipcRenderer.invoke("herdr:set-global-subs", subs),
  setPaneStream: (panes: string | string[] | null) =>
    ipcRenderer.invoke("herdr:set-pane-stream", panes),
  socketInfo: () => ipcRenderer.invoke("herdr:socket-info"),
  notify: (title: string, body: string) =>
    ipcRenderer.invoke("herdr:notify", { title, body }),
  launchServer: () => ipcRenderer.invoke("herdr:launch-server"),
  win: (action: "min" | "max" | "close") =>
    ipcRenderer.invoke("herdr:win", action),
  // F2: local file access for the right tool sidebar
  fsTree: (dir: string, depth?: number) => ipcRenderer.invoke("fs:tree", dir, depth),
  fsRead: (path: string) => ipcRenderer.invoke("fs:read", path),
  fsOpen: (path: string) => ipcRenderer.invoke("fs:open", path),
  // V5 F2: git app (directory-scoped repository status / per-file diff)
  gitStatus: (cwd: string) => ipcRenderer.invoke("git:status", cwd),
  gitDiff: (cwd: string, path: string) => ipcRenderer.invoke("git:diff", cwd, path),
  onEvent: (cb: (ev: { event: string; data: any }) => void) => {
    const listener = (_e: unknown, ev: { event: string; data: any }) => cb(ev);
    ipcRenderer.on("herdr:event", listener);
    return () => ipcRenderer.removeListener("herdr:event", listener);
  },
  onStatus: (cb: (status: string) => void) => {
    const listener = (_e: unknown, status: string) => cb(status);
    ipcRenderer.on("herdr:status", listener);
    return () => ipcRenderer.removeListener("herdr:status", listener);
  },
  onResync: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("herdr:resync", listener);
    return () => ipcRenderer.removeListener("herdr:resync", listener);
  },
  signalUiReady: () => ipcRenderer.send("herdr:ui-ready"),
};

contextBridge.exposeInMainWorld("herdr", api);

export type HerdrApi = typeof api;
