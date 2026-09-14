import type { PaneLayout, PaneReadResult, Snapshot } from "./types";

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

/** Layout snapshot of the tab owning `paneId` (F3 unified mode). */
export function paneLayout(paneId: string): Promise<{ layout: PaneLayout }> {
  return rpc("pane.layout", { pane_id: paneId });
}

/**
 * Resize via herdr. Verified against herdr protocol 19: `amount` is a ratio
 * delta (0..1) that moves the divider toward `direction` ("left"/"right"/
 * "up"/"down"), clamped to the min pane size. The reply carries the fresh
 * layout under `resize.layout`.
 */
export function paneResize(
  paneId: string,
  direction: "left" | "right" | "up" | "down",
  amount: number,
): Promise<{ resize: { changed: boolean; pane_id: string; layout?: PaneLayout } }> {
  return rpc("pane.resize", { pane_id: paneId, direction, amount });
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

/** Type into a pane; pass `keys` (e.g. enter) to also submit. */
export function paneType(paneId: string, text: string, keys: string[] = []): Promise<unknown> {
  return rpc("pane.send_input", { pane_id: paneId, text, keys });
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
