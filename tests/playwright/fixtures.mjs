// Shared fixture: throwaway herdr session + seeded data + app launch.
// Mirrors tests/e2e.test.mjs isolation strategy but yields a Playwright Page.
import { _electron } from "playwright-core";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  startSession,
  stopSession,
  ensureArtifacts,
  PROJECT,
  ARTIFACTS,
} from "../helpers/env.mjs";
import { api, rpc } from "../helpers/herdr-api.mjs";

export const FIXTURES = path.join(PROJECT, "tests", "fixtures");

export function ensureFixtures() {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const md = "# 采样文档\n\n这是一段**加粗**正文。\n\n- 列表项一\n- 列表项二\n";
  fs.writeFileSync(path.join(FIXTURES, "sample.md"), md);
  // 1x1 red PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(path.join(FIXTURES, "sample.png"), png);
  fs.writeFileSync(path.join(FIXTURES, "sample.xyz"), "binary-ish payload");
}

/**
 * Launch the app (built renderer) against a fresh throwaway session with:
 * - workspace "E2E-WS-A" with a second tab "E2E-TAB-2" holding 2 panes
 *   (cwd = tests/fixtures so the file tree has known content)
 * Returns { session, app, page, panes: {pane2, pane3, tab2} }.
 * Caller must call close() on the returned object.
 */
export async function launchStudio({ build } = {}) {
  ensureArtifacts();
  ensureFixtures();
  const session = await startSession("studio-pw-" + Date.now().toString(36));
  const sock = session.socket;

  const wsA = await api.workspaceCreate(sock, {});
  const ws = wsA.result?.workspace ?? wsA.workspace;
  const tab2res = await rpc(sock, "tab.create", { workspace_id: ws.workspace_id });
  const tab2 = tab2res.result?.tab ?? tab2res.tab;
  const pane2 = tab2res.result?.root_pane ?? tab2res.root_pane;
  await rpc(sock, "tab.focus", { tab_id: tab2.tab_id });
  const splitRes = await rpc(sock, "pane.split", {
    target_pane_id: pane2.pane_id,
    workspace_id: ws.workspace_id,
    direction: "right",
    cwd: FIXTURES,
  });
  const pane3 = splitRes.result?.pane ?? splitRes.pane;
  await rpc(sock, "workspace.rename", { workspace_id: ws.workspace_id, label: "E2E-WS-A" });
  await rpc(sock, "tab.rename", { tab_id: tab2.tab_id, label: "E2E-TAB-2" });

  const cdpPort = 9400 + Math.floor(Math.random() * 300);
  const electronBin = path.join(PROJECT, "node_modules", "electron", "dist", "electron.exe");
  const app = await _electron.launch({
    args: [PROJECT, `--remote-debugging-port=${cdpPort}`],
    executablePath: electronBin,
    env: { ...process.env, HERDR_STUDIO_SOCKET: sock },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.__herdr_store?.getState()?.booted, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__herdr_store.getState().status === "connected", null, { timeout: 15000 });

  return {
    session,
    app,
    page,
    sock,
    tab2,
    pane2,
    pane3,
    async close() {
      try { await app.close(); } catch { /* already gone */ }
      await stopSession(session.name);
    },
  };
}
