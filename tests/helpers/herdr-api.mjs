// Minimal herdr socket client for tests (mirrors electron/herdr-client.ts).
import * as net from "node:net";

export function pipePathFor(pointerPath) {
  if (process.platform === "win32") return "\\\\.\\pipe\\" + pointerPath;
  return pointerPath;
}

export function connect(pointerPath, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const s = net.connect(pipePathFor(pointerPath));
    const t = setTimeout(() => {
      s.destroy();
      reject(new Error("connect timeout: " + pointerPath));
    }, timeoutMs);
    s.once("connect", () => {
      clearTimeout(t);
      resolve(s);
    });
    s.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

let seq = 0;

/** One-shot RPC: fresh connection per call, resolves with result. */
export async function rpc(pointerPath, method, params = {}, timeoutMs = 10000) {
  const s = await connect(pointerPath);
  try {
    return await new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error(`${method}: timeout`));
      }, timeoutMs);
      s.on("data", (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.error) {
            clearTimeout(timer);
            s.destroy();
            const err = new Error(`${method}: ${msg.error.message}`);
            err.code = msg.error.code;
            reject(err);
            return;
          }
          if (msg.result !== undefined) {
            clearTimeout(timer);
            s.destroy();
            resolve(msg.result);
            return;
          }
        }
      });
      s.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      s.on("close", () => {
        clearTimeout(timer);
        reject(new Error(`${method}: closed before reply`));
      });
      s.write(JSON.stringify({ id: "t" + ++seq, method, params }) + "\n");
    });
  } finally {
    s.destroy();
  }
}

/** Long-lived event stream; returns {socket, waitReady, events, close}. */
export async function openEventStream(pointerPath, subscriptions) {
  const s = await connect(pointerPath);
  const events = [];
  let buf = "";
  let ready;
  const waitReady = new Promise((res, rej) => (ready = { res, rej }));
  s.on("data", (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id && (msg.result || msg.error)) {
        if (msg.error) rej; // noop: handled below
        ready.res(msg);
        continue;
      }
      if (msg.event) events.push(msg);
    }
  });
  s.on("error", () => {});
  s.write(
    JSON.stringify({ id: "sub", method: "events.subscribe", params: { subscriptions } }) + "\n",
  );
  return {
    socket: s,
    waitReady: () => waitReady,
    events,
    waitFor: async (predicate, timeoutMs = 5000) => {
      const t0 = Date.now();
      let local = [];
      while (Date.now() - t0 < timeoutMs) {
        const found = events.find(predicate);
        if (found) return found;
        await sleep(60);
      }
      void local;
      return null;
    },
    close: () => s.destroy(),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, timeoutMs = 5000, interval = 80, label = "condition") {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(interval);
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms: ${label}${lastErr ? " (last: " + lastErr.message + ")" : ""}`);
}

// ---- Convenience wrappers over common methods ----

export const api = {
  ping: (p) => rpc(p, "ping"),
  snapshot: (p) => rpc(p, "session.snapshot").then((r) => r.snapshot),
  workspaceCreate: (p, params = {}) => rpc(p, "workspace.create", params),
  workspaceList: (p) => rpc(p, "workspace.list").then((r) => r.workspaces),
  tabList: (p, workspaceId) =>
    rpc(p, "tab.list", { workspace_id: workspaceId }).then((r) => r.tabs),
  paneList: (p, workspaceId) =>
    rpc(p, "pane.list", { workspace_id: workspaceId }).then((r) => r.panes),
  paneRead: (p, paneId, source = "recent_unwrapped", lines = 400) =>
    rpc(p, "pane.read", { pane_id: paneId, source, lines, format: "ansi", strip_ansi: false }).then((r) => r.read),
  paneSendInput: (p, paneId, text) => rpc(p, "pane.send_input", { pane_id: paneId, text, keys: ["enter"] }),
  paneSendKeys: (p, paneId, keys) => rpc(p, "pane.send_keys", { pane_id: paneId, keys }),
  paneProcessInfo: (p, paneId) => rpc(p, "pane.process_info", { pane_id: paneId }, 8000),
  paneReportAgent: (p, paneId, agent, state, extra = {}) =>
    rpc(p, "pane.report_agent", { pane_id: paneId, source: "studio-e2e", agent, state, ...extra }),
  paneClearAgent: (p, paneId) => rpc(p, "pane.clear_agent_authority", { pane_id: paneId }),
  agentList: (p) => rpc(p, "agent.list").then((r) => r.agents),
};
