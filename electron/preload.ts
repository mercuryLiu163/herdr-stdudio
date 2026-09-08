import { contextBridge, ipcRenderer } from "electron";

const api = {
  invoke: (method: string, params: unknown, timeoutMs?: number) =>
    ipcRenderer.invoke("herdr:invoke", method, params, timeoutMs),
  setGlobalSubs: (subs: unknown[]) =>
    ipcRenderer.invoke("herdr:set-global-subs", subs),
  setPaneStream: (paneId: string | null) =>
    ipcRenderer.invoke("herdr:set-pane-stream", paneId),
  socketInfo: () => ipcRenderer.invoke("herdr:socket-info"),
  notify: (title: string, body: string) =>
    ipcRenderer.invoke("herdr:notify", { title, body }),
  launchServer: () => ipcRenderer.invoke("herdr:launch-server"),
  win: (action: "min" | "max" | "close") =>
    ipcRenderer.invoke("herdr:win", action),
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
