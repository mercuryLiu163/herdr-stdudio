// E2E: CDP-driven UI tests. Write operations go to a throwaway session only.
import * as fs from "node:fs";
import * as path from "node:path";
import { connectCdp } from "./helpers/cdp.mjs";
import {
  api,
  rpc,
  sleep,
  waitFor,
} from "./helpers/herdr-api.mjs";
import {
  createRunner,
  startSession,
  stopSession,
  launchApp,
  killAllLaunchedApps,
  ensureArtifacts,
  PROJECT,
  ARTIFACTS,
  assert,
  assertEq,
} from "./helpers/env.mjs";

const SESSION = "studio-e2e-ui-" + Date.now().toString(36);
const shot = (name) => path.join(ARTIFACTS, name);

// ---- in-page helpers (evaluated via CDP) ----

const storeState = `(() => { const s = window.__herdr_store?.getState(); return s ? JSON.parse(JSON.stringify({ status: s.status, workspaces: s.workspaces, tabs: s.tabs, panes: s.panes, agents: s.agents, activeWorkspaceId: s.activeWorkspaceId, activeTabId: s.activeTabId, activePaneId: s.activePaneId, outputs: Object.fromEntries(Object.entries(s.outputs).map(([k, v]) => [k, { text: v.text, revision: v.revision }])) })) : null })()`;

const clickByText = (sel, text) => `(() => {
  const els = [...document.querySelectorAll('${sel}')];
  const el = els.find((e) => e.textContent.trim().includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`;

const typeInComposer = (text) => `(() => {
  const ta = document.querySelector('.composer textarea');
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const pressEnterInComposer = `(() => {
  const ta = document.querySelector('.composer textarea');
  if (!ta) return false;
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return true;
})()`;

const composerValue = `document.querySelector('.composer textarea')?.value ?? null`;

async function main() {
  ensureArtifacts();
  const t = createRunner("e2e");

  console.log(`\n[setup] throwaway UI session: ${SESSION}`);
  const sess = await startSession(SESSION);
  const sock = sess.socket;

  // Seed: the session boots with its own default workspace, so create two more
  // with UNIQUE names and a second tab holding two panes for the D tests.
  const wsA = await api.workspaceCreate(sock, {});
  const A = {
    workspace: wsA.result?.workspace ?? wsA.workspace,
    tab1: wsA.result?.tab ?? wsA.tab,
    pane1: wsA.result?.root_pane ?? wsA.root_pane,
  };
  await rpc(sock, "workspace.rename", { workspace_id: A.workspace.workspace_id, label: "E2E-WS-A" });
  A.workspace.label = "E2E-WS-A";
  const tab2res = await rpc(sock, "tab.create", { workspace_id: A.workspace.workspace_id });
  const tab2 = tab2res.result?.tab ?? tab2res.tab;
  const pane2 = tab2res.result?.root_pane ?? tab2res.root_pane;
  // herdr's pane.split operates on the FOCUSED tab, so focus the tab first.
  await rpc(sock, "tab.focus", { tab_id: tab2.tab_id });
  const splitRes = await rpc(sock, "pane.split", {
    target_pane_id: pane2.pane_id,
    workspace_id: A.workspace.workspace_id,
    direction: "right",
    cwd: PROJECT,
  });
  const pane3 = splitRes.result?.pane ?? splitRes.pane;
  await rpc(sock, "tab.rename", { tab_id: tab2.tab_id, label: "E2E-TAB-2" });
  tab2.label = "E2E-TAB-2";
  await rpc(sock, "pane.rename", { pane_id: pane2.pane_id, label: "E2E-P2" });
  await rpc(sock, "pane.rename", { pane_id: pane3.pane_id, label: "E2E-P3" });
  const wsBres = await api.workspaceCreate(sock, {});
  const wsB = wsBres.result?.workspace ?? wsBres.workspace;
  await rpc(sock, "workspace.rename", { workspace_id: wsB.workspace_id, label: "E2E-WS-B" });
  wsB.label = "E2E-WS-B";
  const snap = await api.snapshot(sock);
  console.log(`[setup] seeded: ${snap.workspaces.length} workspaces, ${snap.tabs.length} tabs, ${snap.panes.length} panes`);

  // Global watchdog: never let the suite hang forever.
  const watchdog = setTimeout(() => {
    console.error("\n[e2e] GLOBAL WATCHDOG: suite exceeded 8 minutes, aborting.");
    process.exit(2);
  }, 8 * 60 * 1000);
  watchdog.unref();

  // ---- Instance 1: against the throwaway session ----
  const testLog = path.join(ARTIFACTS, "notifications.jsonl");
  if (fs.existsSync(testLog)) fs.unlinkSync(testLog);
  console.log("\n[setup] launching app instance 1 (isolated session)…");
  const { proc: app, cdpPort } = await launchApp({ socketPath: sock, testLog });
  const cdp = await connectCdp(cdpPort);
  await cdp.waitFor("store booted", `!!(window.__herdr_store?.getState()?.booted)`, 20000);

  // ---- B: lifecycle & connection ----
  await t.run("B1", "应用启动且渲染", async () => {
    const alive = app.exitCode === null && app.pid > 0;
    assert(alive, "electron process alive");
    const hasRoot = await cdp.evaluate(`document.getElementById('root')?.children.length > 0`);
    assert(hasRoot, "root rendered");
  });

  await t.run("B2", "连接状态 connected + 已连接胶囊", async () => {
    await cdp.waitFor("status connected", `window.__herdr_store.getState().status === 'connected'`, 15000);
    const pill = await cdp.evaluate(`document.querySelector('.conn-pill')?.textContent ?? ''`);
    assert(pill.includes("已连接"), "pill shows 已连接, got: " + pill);
  });

  await t.run("B3", "socket-info 指向隔离会话", async () => {
    const info = await cdp.evaluate(`(async () => window.herdr ? window.herdr.socketInfo() : null)()`);
    assert(info?.pointer?.includes(SESSION), "pointer contains session name: " + JSON.stringify(info));
  });

  // ---- C: rendering ----
  await t.run("C1", "store 与 server snapshot 一致", async () => {
    const st = await cdp.evaluate(storeState);
    const serverSnap = await api.snapshot(sock);
    assertEq(st.workspaces.length, serverSnap.workspaces.length, "workspace count");
    assertEq(st.tabs.length, serverSnap.tabs.length, "tab count");
    assertEq(st.panes.length, serverSnap.panes.length, "pane count");
  });

  await t.run("C2", "侧栏工作区条目渲染", async () => {
    const serverSnap = await api.snapshot(sock);
    const n = await cdp.evaluate(`document.querySelectorAll('.ws-item').length`);
    assertEq(n, serverSnap.workspaces.length, "workspace item count matches server");
    const labels = await cdp.evaluate(`[...document.querySelectorAll('.ws-item-label')].map((e) => e.textContent)`);
    assert(labels.some((l) => l === "E2E-WS-A"), "seeded workspace visible: " + JSON.stringify(labels));
    assert(labels.some((l) => l === "E2E-WS-B"), "second seeded workspace visible");
  });

  await t.run("C3", "标签列渲染 + active 高亮", async () => {
    const st = await cdp.evaluate(storeState);
    const tabsOfActive = st.tabs.filter((tb) => tb.workspace_id === st.activeWorkspaceId);
    const n = await cdp.evaluate(`document.querySelectorAll('.tab-item').length`);
    assertEq(n, tabsOfActive.length, "tab items = tabs of active workspace");
    const active = await cdp.evaluate(`document.querySelectorAll('.tab-item.active').length`);
    assertEq(active, 1, "exactly one active tab");
  });

  await t.run("C4", "主区标题 = active tab", async () => {
    const st = await cdp.evaluate(storeState);
    const h1 = await cdp.evaluate(`document.querySelector('.main-header h1')?.textContent ?? ''`);
    const tab = st.tabs.find((x) => x.tab_id === st.activeTabId);
    assertEq(h1, tab?.label ?? null, "h1 equals active tab label");
  });

  await t.run("C5", "pane 芯片渲染 + active 高亮", async () => {
    const chips = await cdp.evaluate(`[...document.querySelectorAll('.pane-chip')].map((e) => ({ text: e.textContent.trim(), active: e.classList.contains('active') }))`);
    const st = await cdp.evaluate(storeState);
    const tabPanes = st.panes.filter((p) => p.tab_id === st.activeTabId);
    assertEq(chips.length, tabPanes.length, "chip count = pane count");
    assert(chips.some((c) => c.active), "one chip active");
    assert(chips.every((c) => c.text.length > 0), "no empty chips: " + JSON.stringify(chips));
  });

  await t.run("C6", "输出卡片 ANSI 渲染非空", async () => {
    await cdp.waitFor("ansi content", `(() => { const a = document.querySelector('.reader-card .ansi'); return !!(a && a.textContent.length > 0); })()`, 10000);
    await cdp.screenshot(shot("e2e-C6-reader.png"));
  });

  // ---- D: interaction ----
  await t.run("D1", "工作区切换", async () => {
    const st0 = await cdp.evaluate(storeState);
    const clicked = await cdp.evaluate(clickByText(".ws-item .ws-item-label", "E2E-WS-B"));
    assert(clicked, "clicked E2E-WS-B item");
    await cdp.waitFor(
      "activeWorkspace = wsB",
      `window.__herdr_store.getState().activeWorkspaceId === ${JSON.stringify(wsB.workspace_id)}`,
      5000,
    );
    void st0;
  });

  await t.run("D2", "标签切换 → 主区标题更新", async () => {
    // Land in workspace A first, then its renamed second tab.
    await cdp.evaluate(clickByText(".ws-item .ws-item-label", "E2E-WS-A"));
    await cdp.waitFor(
      "activeWorkspace = wsA",
      `window.__herdr_store.getState().activeWorkspaceId === ${JSON.stringify(A.workspace.workspace_id)}`,
      5000,
    );
    const clicked = await cdp.evaluate(clickByText(".tab-item", "E2E-TAB-2"));
    assert(clicked, "clicked E2E-TAB-2");
    await cdp.waitFor(
      "activeTab = tab2",
      `window.__herdr_store.getState().activeTabId === ${JSON.stringify(tab2.tab_id)}`,
      5000,
    );
    const h1 = await cdp.evaluate(`document.querySelector('.main-header h1')?.textContent ?? ''`);
    assertEq(h1, "E2E-TAB-2", "h1 follows tab");
  });

  await t.run("D3", "pane 切换 → reader 跟随", async () => {
    // Go to tab2 (has 2 panes: pane2, pane3)
    await cdp.evaluate(clickByText(".tab-item", tab2.label ?? ""));
    await cdp.waitFor("tab2 active", `window.__herdr_store.getState().activeTabId === ${JSON.stringify(tab2.tab_id)}`, 5000);
    const st0 = await cdp.evaluate(storeState);
    const other = st0.panes.find((p) => p.tab_id === tab2.tab_id && p.pane_id !== st0.activePaneId);
    assert(other, "second pane exists in tab2");
    await cdp.evaluate(clickByText(".pane-chip", other.pane_id.split(":p")[1] ?? "shell"));
    await cdp.waitFor("activePane changed", `window.__herdr_store.getState().activePaneId === ${JSON.stringify(other.pane_id)}`, 5000);
    await cdp.waitFor("reader for new pane", `(() => { const s = window.__herdr_store.getState(); const o = s.outputs[s.activePaneId]; return !!(o && o.text.length >= 0); })()`, 6000);
  });

  const markerD4 = "STUDIO_E2E_D4_" + Date.now();
  await t.run("D4", "composer 向 shell 发命令", async () => {
    await cdp.evaluate(typeInComposer(`echo ${markerD4}`));
    await cdp.evaluate(pressEnterInComposer);
    await cdp.waitFor(
      "marker in reader",
      `(() => { const s = window.__herdr_store.getState(); const o = s.outputs[s.activePaneId]; return !!(o && o.text.includes(${JSON.stringify(markerD4)})); })()`,
      8000,
    );
    const serverText = (await api.paneRead(sock, await cdp.evaluate(`window.__herdr_store.getState().activePaneId`))).text;
    assert(serverText.includes(markerD4), "server-side read confirms");
  });

  await t.run("D5", "Shift+Enter 换行不发送；Enter 后清空", async () => {
    await cdp.evaluate(typeInComposer("line-one"));
    await cdp.evaluate(`(() => { const ta = document.querySelector('.composer textarea'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); return true; })()`);
    await sleep(500);
    let v = await cdp.evaluate(composerValue);
    assert(v && v.includes("line-one"), "text kept after shift+enter: " + JSON.stringify(v));
    await cdp.evaluate(typeInComposer("line-two-final"));
    await cdp.evaluate(pressEnterInComposer);
    await cdp.waitFor("composer cleared", `!document.querySelector('.composer textarea')?.value`, 5000);
  });

  await t.run("D6", "Esc 中断按钮 + toast", async () => {
    // NOTE(test-fix): 复审收敛后「Esc 中断」从工具条胶囊行移出，改为悬浮在胶囊
    // 右上角的 ghost chip，且仅在 agent pane 渲染。契约本身不变（点击 → 键码
    // 发出 → toast 确认），因此先给当前 pane 注册一个一次性 fake agent 以满足
    // 新的显示条件，断言后立即注销。
    const activePane = await cdp.evaluate(`window.__herdr_store.getState().activePaneId`);
    await api.paneReportAgent(sock, activePane, "e2e-fake", "working");
    await cdp.waitFor(
      "esc chip rendered for agent pane",
      `(() => {
        const s = window.__herdr_store.getState();
        return !!s.agents.find((a) => a.pane_id === ${JSON.stringify(activePane)})
          && !!document.querySelector("[data-testid='composer-esc']");
      })()`,
      8000,
    );
    await cdp.evaluate(clickByText("button", "Esc 中断"));
    await cdp.waitFor("esc toast", `(() => { const ts = [...document.querySelectorAll('.toast')]; return ts.some((x) => x.textContent.includes('esc')); })()`, 5000);
    await api.paneClearAgent(sock, activePane);
  });

  await t.run("D7", "Ctrl+C 按键 0x03 送达前台程序（raw-mode）", async () => {
    // Windows/ConPTY limitation: native console apps like ping.exe do NOT get
    // interrupted by injected 0x03 (verified by probe). Apps that read raw
    // input (agent TUIs — the button's real use case) DO receive it.
    const paneId = await cdp.evaluate(`window.__herdr_store.getState().activePaneId`);
    void paneId;
    const script =
      'node -e "process.stdin.setRawMode(true);process.stdin.on(\'data\',(d)=>{console.log(\'E2EKEY:\'+JSON.stringify(d.toString()));process.exit(0)})"';
    await cdp.evaluate(typeInComposer(script));
    await cdp.evaluate(pressEnterInComposer);
    await sleep(2000); // let node start and take over the foreground
    await cdp.evaluate(clickByText("button", "Ctrl+C"));
    await cdp.waitFor(
      "raw 0x03 delivered to foreground reader",
      `(() => { const s = window.__herdr_store.getState(); const o = s.outputs[s.activePaneId]; return !!(o && o.text.includes('E2EKEY')); })()`,
      8000,
    );
  }, { optional: true });

  // Helper: click a pane chip by its index in the rendered chip row.
  const clickChipByIndex = (idx) => `document.querySelectorAll('.pane-chip')[${idx}]?.click() ?? false`;
  const chipIndexOf = async (paneId) => {
    const st = await cdp.evaluate(storeState);
    const tabPanes = st.panes.filter((p) => p.tab_id === st.activeTabId);
    return tabPanes.findIndex((p) => p.pane_id === paneId);
  };

  // D8/D9: fake agent lifecycle on pane2; end in working so D10 can prompt.
  await t.run("D8", "fake agent 状态显示 working↔blocked", async () => {
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
    await cdp.waitFor(
      "agent working in store",
      `(() => { const s = window.__herdr_store.getState(); return s.agents.some((a) => a.pane_id === ${JSON.stringify(pane2.pane_id)} && a.agent_status === 'working'); })()`,
      8000,
    );
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "blocked");
    await cdp.waitFor(
      "agent blocked in store + UI dot",
      `(() => { const s = window.__herdr_store.getState(); const dot = [...document.querySelectorAll('.tab-item .sdot')].some((d) => d.classList.contains('blocked')); return s.agents.some((a) => a.pane_id === ${JSON.stringify(pane2.pane_id)} && a.agent_status === 'blocked') && dot; })()`,
      10000,
    );
    await cdp.screenshot(shot("e2e-D8-agent-blocked.png"));
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
    await cdp.waitFor(
      "agent restored to working",
      `(() => { const s = window.__herdr_store.getState(); return s.agents.some((a) => a.pane_id === ${JSON.stringify(pane2.pane_id)} && a.agent_status === 'working'); })()`,
      10000,
    );
  });

  await t.run("D9", "blocked → 系统通知记录", async () => {
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "blocked");
    await waitFor(() => {
      if (!fs.existsSync(testLog)) return false;
      const lines = fs.readFileSync(testLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      return lines.some((l) => (l.title ?? "").includes("需要"));
    }, 10000, 200, "blocked notification recorded");
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
  });

  const markerD10 = "STUDIO_E2E_D10_" + Date.now();
  await t.run("D10", "agent prompt 经 fallback 送达 pane 且无内联错误", async () => {
    const idx = await chipIndexOf(pane2.pane_id);
    assert(idx >= 0, "pane2 chip index found");
    await cdp.evaluate(clickChipByIndex(idx));
    await sleep(400);
    const hasAgent = await cdp.evaluate(
      `(() => { const s = window.__herdr_store.getState(); return !!s.agents.find((x) => x.pane_id === ${JSON.stringify(pane2.pane_id)}); })()`,
    );
    assert(hasAgent, "agent present in store");
    await cdp.evaluate(typeInComposer(`echo ${markerD10}`));
    await cdp.evaluate(pressEnterInComposer);
    // NOTE(test-fix): V4 F2 made the composer's error handling deliberate —
    // when herdr rejects agent.prompt with "is not an active named agent"
    // (exactly the authority-reported fake agent seeded here), the composer
    // degrades to the plain-text TUI channel instead of surfacing an inline
    // error. The old assertion demanded that swallowed error inline, which
    // contradicts the fallback by design. Assert the actual contract instead:
    // the prompt is DELIVERED via the fallback (marker shows up in the pane's
    // transcript) and no inline error is displayed.
    await cdp.waitFor(
      "prompt delivered via fallback (marker in transcript, no inline error)",
      `(() => {
        const s = window.__herdr_store.getState();
        const o = s.outputs[s.activePaneId];
        return !!(o && o.text.includes(${JSON.stringify(markerD10)}))
          && !document.querySelector('.inline-error');
      })()`,
      20000,
    );
  }, { optional: true });

  await t.run("A9/D-cleanup", "注销 fake agent", async () => {
    await api.paneClearAgent(sock, pane2.pane_id);
    await cdp.waitFor(
      "agent removed",
      `(() => { const s = window.__herdr_store.getState(); return !s.agents.some((a) => a.pane_id === ${JSON.stringify(pane2.pane_id)}); })()`,
      8000,
    );
  });

  const markerD11 = "STUDIO_E2E_D11_" + Date.now();
  await t.run("D11", "实时输出推送 1.5s 内到 UI", async () => {
    const activePane = await cdp.evaluate(`window.__herdr_store.getState().activePaneId`);
    const t0 = Date.now();
    await api.paneSendInput(sock, activePane, `echo ${markerD11}`);
    let within = -1;
    await waitFor(
      async () => {
        const has = await cdp.evaluate(
          `(() => { const s = window.__herdr_store.getState(); const o = s.outputs[s.activePaneId]; return !!(o && o.text.includes(${JSON.stringify(markerD11)})); })()`,
        );
        if (has && within < 0) within = Date.now() - t0;
        return has;
      },
      6000, 100, "push arrives",
    );
    assert(within >= 0 && within <= 1500 + 500, `push→UI latency ${within}ms (budget ~2000ms incl. poll)`);
  });

  await t.run("D12", "切换 pane 流跟随且互不串扰", async () => {
    // Defensive: flush pane3 to a fresh prompt line.
    await api.paneSendInput(sock, pane3.pane_id, "");
    await sleep(800);
    const m1 = "D12_P1_" + Date.now();
    const m2 = "D12_P2_" + Date.now();
    await api.paneSendInput(sock, pane2.pane_id, `echo ${m1}`);
    await api.paneSendInput(sock, pane3.pane_id, `echo ${m2}`);
    await sleep(600);
    // select pane2 via its chip (by index)
    const idx2 = await chipIndexOf(pane2.pane_id);
    assert(idx2 >= 0, "pane2 chip visible");
    await cdp.evaluate(clickChipByIndex(idx2));
    await cdp.waitFor("pane2 shows m1", `(() => { const s = window.__herdr_store.getState(); return s.outputs[${JSON.stringify(pane2.pane_id)}]?.text?.includes(${JSON.stringify(m1)}); })()`, 6000);
    // select pane3 via its chip (by index)
    const idx3 = await chipIndexOf(pane3.pane_id);
    assert(idx3 >= 0, "pane3 chip visible");
    await cdp.evaluate(clickChipByIndex(idx3));
    await cdp.waitFor("pane3 shows m2", `(() => { const s = window.__herdr_store.getState(); return s.outputs[${JSON.stringify(pane3.pane_id)}]?.text?.includes(${JSON.stringify(m2)}); })()`, 6000);
  });

  // ---- E: resilience ----
  await t.run("E1", "no-server 空态", async () => {
    const { proc: badApp, cdpPort: badPort } = await launchApp({
      socketPath: path.join(ARTIFACTS, "nonexistent.sock"),
    });
    try {
      const badCdp = await connectCdp(badPort);
      await badCdp.waitFor(
        "no-server UI",
        `(() => { const s = window.__herdr_store?.getState?.(); const btn = [...document.querySelectorAll('button')].some((b) => b.textContent.includes('启动 herdr')); return !!(s?.status === 'no-server' && btn); })()`,
        20000,
      );
      await badCdp.screenshot(shot("e2e-E1-noserver.png"));
      await badCdp.close();
    } finally {
      badApp.kill();
    }
  });

  await t.run("E2", "断线重连恢复", async () => {
    // Stop the throwaway session daemon; app should notice.
    await stopSession(SESSION);
    // stopSession also deletes; recreate for reconnect
    await sleep(1500);
    const sawReconnecting = await cdp.evaluate(
      `window.__herdr_store.getState().status === 'reconnecting' || window.__herdr_store.getState().status !== 'connected'`,
    );
    assert(sawReconnecting, "status left connected after server stop");
    await startSession(SESSION);
    await cdp.waitFor(
      "reconnected",
      `window.__herdr_store.getState().status === 'connected'`,
      25000,
    );
    await cdp.waitFor(
      "data reloaded",
      `window.__herdr_store.getState().workspaces.length >= 1`,
      15000,
    );
  });

  await t.run("E3", "关闭按钮退出进程", async () => {
    let exited = false;
    app.once("exit", () => (exited = true));
    await cdp.evaluate(clickByText("button", ""));
    await cdp.evaluate(`document.querySelector('.win-btn.close')?.click()`);
    await waitFor(() => exited || app.exitCode !== null, 8000, 100, "electron exits");
    await cdp.close();
  });

  const { pass, failed } = t.summary();

  console.log("\n[cleanup] instance 1 vs default session (read-only smoke)…");
  // ---- F1: read-only smoke against the DEFAULT session ----
  const tf = createRunner("readonly-default");
  await tf.run("F1", "默认会话只读冒烟", async () => {
    const defaultSocket = path.join(
      process.env.APPDATA ?? "", "herdr", "herdr.sock",
    );
    const { proc: appF, cdpPort: portF } = await launchApp({ socketPath: defaultSocket });
    try {
      const cdpF = await connectCdp(portF);
      await cdpF.waitFor("booted", `!!(window.__herdr_store?.getState()?.booted)`, 20000);
      await cdpF.waitFor(
        "connected with workspaces",
        `(() => { const s = window.__herdr_store.getState(); return s.status === 'connected' && s.workspaces.length >= 1; })()`,
        15000,
      );
      await cdpF.screenshot(shot("e2e-F1-default.png"));
      cdpF.close();
    } finally {
      appF.kill();
    }
  });
  const fResult = tf.summary();

  console.log(`\n[cleanup] stopping session ${SESSION}…`);
  await stopSession(SESSION);
  if (app.exitCode === null) app.kill();

  const allOk = pass && fResult.pass;
  console.log(allOk ? "\n[e2e] ALL GREEN" : `\n[e2e] FAILURES: ${[...failed, ...fResult.failed].map((f) => f.id).join(", ")}`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error("[e2e] fatal:", e);
  killAllLaunchedApps();
  try { await stopSession(SESSION); } catch {}
  process.exit(1);
});
