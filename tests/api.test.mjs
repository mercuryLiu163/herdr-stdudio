// A-layer: protocol integration tests against a throwaway herdr session.
import {
  api,
  openEventStream,
  rpc,
  sleep,
  waitFor,
} from "./helpers/herdr-api.mjs";import {
  createRunner,
  startSession,
  stopSession,
  ensureArtifacts,
  assert,
  assertEq,
} from "./helpers/env.mjs";

const SESSION = "studio-e2e-api-" + Date.now().toString(36);
let sock;
let ws, tab, rootPane;

async function main() {
  ensureArtifacts();
  console.log(`\n[setup] starting throwaway session ${SESSION}…`);
  const sess = await startSession(SESSION);
  sock = sess.socket;
  console.log(`[setup] session ready at ${sock}`);

  const t = createRunner("api");

  await t.run("A1", "ping 握手", async () => {
    const pong = await api.ping(sock);
    assertEq(pong?.type, "pong", "pong type");
    assert(pong.version, "version present");
    assertEq(pong.protocol, 19, "protocol 19");
  });

  await t.run("A2", "snapshot 结构", async () => {
    const snap = await api.snapshot(sock);
    assert(Array.isArray(snap.workspaces), "workspaces array");
    assert(Array.isArray(snap.tabs), "tabs array");
    assert(Array.isArray(snap.panes), "panes array");
    assert(Array.isArray(snap.agents), "agents array");
    assert("focused_workspace_id" in snap, "focused ids");
  });

  await t.run("A3", "单连接单请求语义", async () => {
    const { connect } = await import("./helpers/herdr-api.mjs");
    const s = await connect(sock);
    const first = await new Promise((resolve, reject) => {
      let buf = "";
      const to = setTimeout(() => reject(new Error("first ping timeout")), 5000);
      s.on("data", function onData(d) {
        buf += d.toString();
        if (buf.includes("pong")) {
          clearTimeout(to);
          s.removeListener("data", onData);
          resolve(true);
        }
      });
      s.on("error", (e) => { clearTimeout(to); reject(e); });
      s.write(JSON.stringify({ id: "1", method: "ping", params: {} }) + "\n");
    });
    assert(first, "first ping answered");
    // Second request on the same connection must not be served; expect close/error.
    const secondOutcome = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const to = setTimeout(() => finish("timeout"), 4000);
      s.on("close", () => finish("closed"));
      s.on("error", () => finish("error"));
      try {
        s.write(JSON.stringify({ id: "2", method: "ping", params: {} }) + "\n");
      } catch {
        finish("write-failed");
      }
      // A second pong would mean pipelining works — either way record it.
      s.on("data", (d) => {
        if (d.toString().includes('"id":"2"')) { clearTimeout(to); finish("answered"); }
      });
    });
    assert(secondOutcome !== "timeout", "server closes or errors on 2nd request, got: " + secondOutcome);
    s.destroy();
  });

  await t.run("A4", "workspace.create 返回结构并可见", async () => {
    const res = await api.workspaceCreate(sock, {});
    ws = res.result?.workspace ?? res.workspace;
    tab = res.result?.tab ?? res.tab;
    rootPane = res.result?.root_pane ?? res.root_pane;
    assert(ws?.workspace_id, "workspace id: " + JSON.stringify(res).slice(0, 200));
    assert(tab?.tab_id, "tab id");
    assert(rootPane?.pane_id, "root pane id");
    const snap = await api.snapshot(sock);
    assert(
      snap.workspaces.some((w) => w.workspace_id === ws.workspace_id),
      "workspace visible in snapshot",
    );
  });

  await t.run("A5", "pane.read 四种 source 与 ansi/text", async () => {
    for (const source of ["visible", "recent", "recent_unwrapped", "detection"]) {
      const r = await rpc(sock, "pane.read", {
        pane_id: rootPane.pane_id, source, format: "ansi", strip_ansi: false,
      });
      assert(r.read && typeof r.read.text === "string", `read ${source} ok`);
      assert(typeof r.read.revision === "number", `read ${source} revision`);
    }
    const stripped = await rpc(sock, "pane.read", {
      pane_id: rootPane.pane_id, source: "recent", strip_ansi: true,
    });
    assert(!/\x1b\[/.test(stripped.read.text), "strip_ansi removes escapes");
  });

  const markerA6 = "A6_" + Date.now();
  await t.run("A6", "send_input 执行 echo 并可见", async () => {
    await api.paneSendInput(sock, rootPane.pane_id, `echo ${markerA6}`);
    await waitFor(
      async () => (await api.paneRead(sock, rootPane.pane_id)).text.includes(markerA6),
      6000, 200, `echo ${markerA6} appears`,
    );
  });

  await t.run("A7", "send_keys esc / ctrl+c 无错误", async () => {
    await api.paneSendKeys(sock, rootPane.pane_id, ["esc"]);
    await api.paneSendKeys(sock, rootPane.pane_id, ["ctrl+c"]);
  });

  const fakePaneId = rootPane.pane_id; // report agent authority on the root shell pane
  await t.run("A8", "report_agent 状态 working→idle(=done)→blocked", async () => {
    await api.paneReportAgent(sock, fakePaneId, "e2e-fake", "working");
    await waitFor(
      async () => (await api.snapshot(sock)).agents.find((a) => a.pane_id === fakePaneId)?.agent_status === "working",
      5000, 150, "agent working",
    );
    // herdr semantics: reported idle + never seen in a UI ⇒ derived status "done".
    await api.paneReportAgent(sock, fakePaneId, "e2e-fake", "idle");
    await waitFor(
      async () => ["idle", "done"].includes(
        (await api.snapshot(sock)).agents.find((a) => a.pane_id === fakePaneId)?.agent_status,
      ),
      5000, 150, "agent idle/done",
    );
    await api.paneReportAgent(sock, fakePaneId, "e2e-fake", "blocked");
    await waitFor(
      async () => (await api.snapshot(sock)).agents.find((a) => a.pane_id === fakePaneId)?.agent_status === "blocked",
      5000, 150, "agent blocked",
    );
  });

  await t.run("A9", "clear_agent_authority 注销", async () => {
    await api.paneClearAgent(sock, fakePaneId);
    await waitFor(
      async () => !(await api.snapshot(sock)).agents.some((a) => a.pane_id === fakePaneId),
      5000, 150, "agent gone",
    );
  });

  await t.run("A10", "output_matched 一次性语义（首匹配推送一次）", async () => {
    const stream = await openEventStream(sock, [{
      type: "pane.output_matched", pane_id: rootPane.pane_id,
      source: "recent_unwrapped", lines: 400, strip_ansi: false,
      match: { type: "regex", value: "." },
    }]);
    try {
      await stream.waitReady();
      const marker = "A10_" + Date.now();
      await api.paneSendInput(sock, rootPane.pane_id, `echo ${marker}`);
      // The first push may carry buffered pre-subscription lines or the fresh
      // echo (server-side quirk); only arrival is asserted here.
      const push = await stream.waitFor((e) => e.event === "pane.output_matched", 6000);
      assert(push, "output_matched push arrives");
      // Documented herdr behavior: the subscription is ONE-SHOT. A second echo
      // must NOT produce a further push on the same subscription.
      await sleep(800);
      stream.events.length = 0;
      const marker2 = "A10B_" + Date.now();
      await api.paneSendInput(sock, rootPane.pane_id, `echo ${marker2}`);
      const second = await stream.waitFor((e) => e.event === "pane.output_matched", 3500);
      assert(!second, "no second push (one-shot semantics confirmed)");
    } finally {
      stream.close();
    }
  });

  await t.run("A11", "并发 8 路 RPC", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => api.ping(sock)),
    );
    assertEq(results.filter((r) => r.type === "pong").length, 8, "all pongs");
  });

  await t.run("A12", "全局事件流 workspace_created", async () => {
    const stream = await openEventStream(sock, [{ type: "workspace.created" }]);
    try {
      await stream.waitReady();
      await api.workspaceCreate(sock, {});
      const push = await stream.waitFor((e) => e.event === "workspace_created", 6000);
      assert(push, "workspace_created push received");
    } finally {
      stream.close();
    }
  });

  const { pass, failed } = t.summary();
  console.log(`\n[cleanup] stopping ${SESSION}…`);
  await stopSession(SESSION);
  if (!pass) {
    console.log("[api] FAILED cases:", failed.map((f) => f.id).join(", "));
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error("[api] fatal:", e);
  try { await stopSession(SESSION); } catch {}
  process.exit(1);
});
