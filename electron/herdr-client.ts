import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";

/**
 * Client for the herdr server socket API.
 *
 * Wire facts (verified against herdr 0.8.0-preview, protocol 19):
 * - Windows: `%APPDATA%\herdr\herdr.sock` is a pointer file; the real endpoint
 *   is a named pipe whose name is the pointer file's full path prefixed with
 *   `\\.\pipe\`. On POSIX the pointer file IS the unix socket.
 * - Framing is newline-delimited JSON. Requests `{id, method, params}` get
 *   exactly one reply `{id, result}` or `{id, error}`; the server then closes
 *   the connection — so every request uses a fresh connection.
 * - `events.subscribe` is the exception: it keeps its connection open and
 *   pushes `{"event", "data"}` envelopes until disconnected.
 */

export type RpcResult = { type: string } & Record<string, unknown>;

export interface Subscription {
  type: string;
  pane_id?: string;
  [k: string]: unknown;
}

export type ConnStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "no-server";

const POINTER_NAME = "herdr.sock";

function pointerPath(): string {
  // Prefer an explicit override, then the per-user config dir.
  if (process.env.HERDR_STUDIO_SOCKET) return process.env.HERDR_STUDIO_SOCKET;
  const dir =
    process.env.APPDATA ?? path.join(process.env.HOME ?? "", "AppData", "Roaming");
  return path.join(dir, "herdr", POINTER_NAME);
}

function endpointFor(pointer: string): { kind: "pipe" | "unix"; target: string } {
  if (process.platform === "win32") {
    return { kind: "pipe", target: "\\\\.\\pipe\\" + pointer };
  }
  return { kind: "unix", target: pointer };
}

export function socketDescription(): { pointer: string; target: string } {
  const pointer = pointerPath();
  const ep = endpointFor(pointer);
  return { pointer, target: ep.target };
}

function connectOnce(timeoutMs: number): Promise<net.Socket> {
  const ep = endpointFor(pointerPath());
  return new Promise((resolve, reject) => {
    const s =
      ep.kind === "pipe" ? net.connect(ep.target) : net.connect({ path: ep.target });
    const timer = setTimeout(() => {
      s.destroy();
      reject(new Error("connect timeout"));
    }, timeoutMs);
    s.once("connect", () => {
      clearTimeout(timer);
      resolve(s);
    });
    s.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export class HerdrClient {
  private sem = 0;
  private readonly maxConcurrent = 8;
  private queue: (() => void)[] = [];

  private async acquire(): Promise<() => void> {
    if (this.sem < this.maxConcurrent) {
      this.sem++;
      return () => {
        this.sem--;
        const next = this.queue.shift();
        if (next) next();
      };
    }
    await new Promise<void>((res) => this.queue.push(res));
    this.sem++;
    return () => {
      this.sem--;
      const next = this.queue.shift();
      if (next) next();
    };
  }

  /** Single-shot RPC: one connection, one request, one reply. */
  async rpc(method: string, params: unknown, timeoutMs = 30_000): Promise<RpcResult> {
    const release = await this.acquire();
    try {
      const s = await connectOnce(4_000);
      try {
        return await new Promise<RpcResult>((resolve, reject) => {
          let buf = "";
          const timer = setTimeout(() => {
            s.destroy();
            reject(new Error(`${method}: timeout after ${timeoutMs}ms`));
          }, timeoutMs);
          s.on("data", (d: Buffer) => {
            buf += d.toString("utf8");
            let idx: number;
            while ((idx = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 1);
              if (!line) continue;
              let msg: any;
              try {
                msg = JSON.parse(line);
              } catch {
                continue;
              }
              if (msg.error) {
                clearTimeout(timer);
                s.destroy();
                const err = new Error(
                  `${method}: ${msg.error.message ?? "unknown error"}`,
                ) as Error & { code?: string };
                err.code = msg.error.code;
                reject(err);
                return;
              }
              if (msg.result !== undefined) {
                clearTimeout(timer);
                s.destroy();
                resolve(msg.result as RpcResult);
                return;
              }
            }
          });
          s.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
          });
          s.on("close", () => {
            clearTimeout(timer);
            reject(new Error(`${method}: connection closed before reply`));
          });
          s.write(JSON.stringify({ id: "s", method, params }) + "\n");
        });
      } finally {
        s.destroy();
      }
    } finally {
      release();
    }
  }

  /**
   * Long-lived subscription connection. Resolves after the subscription is
   * accepted, then feeds pushed envelopes to onEvent. Never resolves a second
   * time; the returned connection lives until the server or we close it.
   */
  async openEventStream(
    subscriptions: Subscription[],
    onEvent: (ev: { event: string; data: any }) => void,
    onDown: () => void,
  ): Promise<net.Socket> {
    const s = await connectOnce(4_000);
    let buf = "";
    let subscribed = false;
    s.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (!subscribed && msg.id && (msg.result || msg.error)) {
          subscribed = true;
          if (msg.error) {
            s.destroy();
            onDown();
            return;
          }
          continue;
        }
        if (msg.event) onEvent(msg);
      }
    });
    s.on("error", () => {
      /* close follows */
    });
    s.on("close", () => onDown());
    s.write(
      JSON.stringify({
        id: "sub",
        method: "events.subscribe",
        params: { subscriptions },
      }) + "\n",
    );
    return s;
  }
}

export function launchHerdrServer(): void {
  const child = spawn("herdr", [], {
    detached: true,
    stdio: "ignore",
    shell: true,
  });
  child.unref();
}

export function pointerExists(): boolean {
  try {
    return fs.statSync(pointerPath()).isFile();
  } catch {
    return false;
  }
}
