import type { PaneReadResult, Snapshot } from "./types";

/** Typed wrappers for the herdr socket methods the studio uses. */

async function rpc<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
  const res = await window.herdr.invoke(method, params ?? {}, timeoutMs);
  return res as unknown as T;
}

export function snapshot(): Promise<{ snapshot: Snapshot }> {
  return rpc("session.snapshot");
}

export function paneRead(
  paneId: string,
  source = "recent_unwrapped",
  lines = 400,
): Promise<{ read: PaneReadResult }> {
  return rpc("pane.read", {
    pane_id: paneId,
    source,
    lines,
    format: "ansi",
    strip_ansi: false,
  });
}

export function agentPrompt(
  target: string,
  text: string,
): Promise<unknown> {
  return rpc("agent.prompt", { target, text }, 15_000);
}

export function paneSendText(paneId: string, text: string): Promise<unknown> {
  return rpc("pane.send_input", { pane_id: paneId, text, keys: ["enter"] });
}

export function paneSendKeys(paneId: string, keys: string[]): Promise<unknown> {
  return rpc("pane.send_keys", { pane_id: paneId, keys });
}

export function agentSendKeys(target: string, keys: string[]): Promise<unknown> {
  return rpc("agent.send_keys", { target, keys });
}

export function agentGet(nameOrPane: string): Promise<{ agent: any }> {
  return rpc("agent.get", { target: nameOrPane });
}
