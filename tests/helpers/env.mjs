// Environment lifecycle: throwaway herdr sessions, app process, artifacts.
import { spawn, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { api, sleep, waitFor } from "./herdr-api.mjs";

export const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ARTIFACTS = path.join(PROJECT, "tests", "artifacts");

export function ensureArtifacts() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
}

export function herdrBin() {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const candidates = [
    path.join(local, "Programs", "Herdr", "bin", "herdr.exe"),
    path.join(local, "Programs", "Herdr", "bin", "herdr"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("herdr binary not found in " + local);
}

export function sessionsDir() {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "herdr", "sessions");
}

export function sessionSocketPath(name) {
  return path.join(sessionsDir(), name, "herdr.sock");
}

/** Start a throwaway named session (TUI client detached keeps the daemon up). */
export async function startSession(name) {
  const bin = herdrBin();
  const child = spawn(bin, ["--session", name], { detached: true, stdio: "ignore" });
  child.unref();
  const socket = sessionSocketPath(name);
  // Wait for the socket endpoint to answer ping.
  await waitFor(
    async () => {
      try {
        await api.ping(socket);
        return true;
      } catch {
        return false;
      }
    },
    30000,
    500,
    `session ${name} becomes reachable`,
  );
  return { name, pid: child.pid, socket };
}

/** Stop + delete the named session. Never touches the default session. */
export async function stopSession(name) {
  const bin = herdrBin();
  for (const args of [["session", "stop", name, "--json"], ["session", "delete", name, "--json"]]) {
    try {
      execSync(`${JSON.stringify(bin)} ${args.join(" ")}`, { shell: true, stdio: "ignore", timeout: 15000 });
    } catch {
      try {
        execSync(`"${bin}" ${args.join(" ")}`, { shell: true, stdio: "ignore", timeout: 15000 });
      } catch {
        /* already gone */
      }
    }
  }
}

let electronSeq = 0;
const launchedProcs = new Set();

/** Kill any app processes a test launched but never cleaned up. */
export function killAllLaunchedApps() {
  for (const p of launchedProcs) {
    try {
      if (p.exitCode === null) p.kill();
    } catch {
      /* already gone */
    }
  }
  launchedProcs.clear();
}

/**
 * Launch the built app pointed at `socketPath` with a CDP port.
 * Returns {proc, cdpPort, env}. Caller must `proc.kill()` on cleanup.
 */
export async function launchApp({ socketPath, cdpPort, testLog, onExit }) {
  const electronBin = path.join(PROJECT, "node_modules", "electron", "dist", "electron.exe");
  if (!fs.existsSync(electronBin)) throw new Error("electron.exe missing — run npm install");
  cdpPort = cdpPort ?? 9333 + (++electronSeq % 300);
  const env = {
    ...process.env,
    HERDR_STUDIO_SOCKET: socketPath,
    ELECTRON_ENABLE_LOGGING: "1",
  };
  if (testLog) env.HERDR_STUDIO_TEST_LOG = testLog;
  const proc = spawn(electronBin, [PROJECT, `--remote-debugging-port=${cdpPort}`], {
    cwd: PROJECT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  proc.stdout.on("data", (d) => logs.push(d.toString()));
  proc.stderr.on("data", (d) => logs.push(d.toString()));
  if (onExit) proc.once("exit", onExit);
  launchedProcs.add(proc);
  proc.once("exit", () => launchedProcs.delete(proc));
  proc.logs = logs;
  await sleep(700); // give the process a moment to fail fast if broken
  if (proc.exitCode !== null) {
    throw new Error("electron exited immediately: " + logs.join("").slice(0, 800));
  }
  return { proc, cdpPort };
}

// ---- Micro test runner ----

export function createRunner(suiteName) {
  const results = [];
  let count = 0;
  return {
    results,
    async run(id, title, fn, { optional = false } = {}) {
      count++;
      console.log(`  ▶ ${id} ${title}`);
      const t0 = Date.now();
      try {
        await fn();
        results.push({ id, title, ok: true, ms: Date.now() - t0, optional });
        console.log(`  ✅ ${id} ${title} (${Date.now() - t0}ms)`);
      } catch (e) {
        results.push({ id, title, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e), optional });
        console.log(`  ❌ ${id} ${title} (${Date.now() - t0}ms)\n     ${String(e?.message ?? e).slice(0, 500)}`);
      }
    },
    summary() {
      const failed = results.filter((r) => !r.ok);
      const hardFailed = failed.filter((r) => !r.optional);
      console.log(`\n[${suiteName}] ${results.length - failed.length}/${results.length} passed${failed.length ? `, ${failed.length} failed (${hardFailed.length} required)` : ""}`);
      return { pass: hardFailed.length === 0, failed };
    },
  };
}

export function assert(cond, msg) {
  if (!cond) throw new Error("assert failed: " + msg);
}

export function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`assertEq failed: ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
