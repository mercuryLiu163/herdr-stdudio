# -*- coding: utf-8 -*-
# One-off merge: append F5/F6/F7 to existing V7 PRD and spec.

prd_path = 'docs/plans/2026-09-13-v7-prd.md'
spec_path = 'tests/playwright/v7-features.spec.mjs'

prd = open(prd_path, encoding='utf-8').read()
if 'F5 Composer' in prd:
    print('PRD already merged, skip')
else:
    prd += '\n---\n\n## F5 Composer 状态栏（复刻 mcode 底部分段胶囊；设计语言见 high-end-visual-design / aceternity-ui 技能）\n\n'
    prd += 'Double-Bezel 嵌套外壳（wash 底 + 发丝 ring + 大圆角），分段间发丝竖线，动效一律 cubic-bezier(0.32,0.72,0,1)、按压 scale(0.98)；GPU 安全：动画只许 transform/opacity。\n\n'
    prd += '分段（左→右，映射 herdr 真实能力，不做假功能）：\n'
    prd += '1. `[data-testid="toolbar-attach"]` 引用文件：弹出 cwd 一级文件浅列表，点选插入 `@<相对路径> ` 到输入框光标处\n'
    prd += '2. `[data-testid="toolbar-target"]` 目标 ∨：下拉列当前 tab 全部 pane，选择切换输入目标（与 input-target 同字段双向同步）\n'
    prd += '3. `[data-testid="toolbar-view"]` 视图 ∨：对话 / 原始输出（与既有 view 分段同字段）\n'
    prd += '4. `[data-testid="toolbar-model"]` 模型 ∨（仅 agent pane）：该 kind 模型预设下拉，选择立即发送 `/model <名>`（走 V4 斜杠通道）\n'
    prd += '5. `[data-testid="toolbar-status"]` 状态环：working=转圈 / idle 绿 / blocked 琥珀 / done 蓝 + 状态词\n'
    prd += '6. `[data-testid="send-button"]` 发送：Button-in-Button（主胶囊右端内嵌 28px 圆形 accent 钮，hover 内圆位移微放大，active scale(0.98)）\n\n'
    prd += '下拉菜单 = 浮层玻璃面板（大扩散低透明阴影），开合 160-220ms 自定义曲线。\n\n'
    prd += '## F6 thinking 沉浸化（ZCode 式转圈）\n\n'
    prd += '- agent working 期间：turn 内全部 thinking 块合并为一条实时行 `[data-testid="thinking-live"]` = 纯 CSS spinner（`[data-testid="thinking-spinner"]`，transform 旋转）+ 「思考中 Ns」；思考内容不展开不逐行下坠\n'
    prd += '- turn 结束（idle/done/blocked）：spinner 移除，定格「思考 Ns」静态行（保留点击展开占位）\n'
    prd += '- 流式到达多条 thinking 时实时行数恒 ≤ 1；最终结果照常流入主体数据流区\n\n'
    prd += '## F7 卡顿根修（硬性评审项）\n\n'
    prd += '1. spinner 一律 CSS keyframes（transform），禁止 JS interval/setState 逐帧驱动（grep 验证）\n'
    prd += '2. 秒数时钟独立组件 `<Elapsed>`（自有 1s interval + 本地 state + memo 隔离）；断言：pane 文本流式更新前后时钟 DOM 节点身份不变\n'
    prd += '3. 贴底滚动 rAF 调度，禁止文本 tick 内同步读布局\n'
    prd += '4. turn-header 时间 tabular-nums，仅 updatedAt 变化时更新\n\n'
    prd += '## 验收（追加）\n\n'
    prd += '- F5×4 / F6×2 / F7×2（见 v7-features.spec.mjs 对应 describe）\n'
    prd += '- 既有 F1–F4 全绿（含当前失败的 F1 续行用例——实现需修复）\n'
    prd += '- 既有 v2–v6 + run-all 全绿；typecheck；无新增依赖\n'
    open(prd_path, 'w', encoding='utf-8').write(prd)
    print('PRD appended')

spec = open(spec_path, encoding='utf-8').read()
if 'F5 composer toolbar' in spec:
    print('spec already merged, skip')
else:
    addition = '\n\n// ---------- F5 Composer 状态栏 ----------\n'
    addition += 'async function seedAgentV7() {\n'
    addition += "  const { sock, pane2 } = ctx;\n"
    addition += "  await api.paneSendInput(\n"
    addition += "    sock,\n    pane2.pane_id,\n"
    addition += "    'echo \"\\u276f \\u5f00\\u59cb\\u4efb\\u52a1\"; echo \"Thought for 2s (ctrl+o to expand)\"; echo \"\\u23fa Edit(src/index.js)\"; echo \"\\u5b8c\\u6210\\u3002\"',\n  );\n"
    addition += "  await api.paneReportAgent(sock, pane2.pane_id, \"e2e-fake\", \"working\");\n"
    addition += "  const { page } = ctx;\n"
    addition += "  await page.waitForFunction(\n    (pid) => window.__herdr_store.getState().agents.some((a) => a.pane_id === pid),\n    pane2.pane_id,\n    { timeout: 10000 },\n  );\n"
    addition += "  await page.locator(\".pane-chip\").filter({ hasText: /e2e-fake agent|E2E/ }).first().click().catch(() => {});\n}\n"
    addition += '''
test.describe("F5 composer toolbar", () => {
  test("分段齐全（Double-Bezel 工具条）", async () => {
    await seedAgentV7();
    const { page } = ctx;
    await expect(page.getByTestId("composer-toolbar")).toBeVisible();
    for (const id of ["toolbar-attach", "toolbar-target", "toolbar-view", "toolbar-model", "toolbar-status", "send-button"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test("target 下拉切换输入目标", async () => {
    await seedAgentV7();
    const { page, pane3 } = ctx;
    await page.getByTestId("toolbar-target").click();
    const menu = page.getByTestId("toolbar-menu");
    await expect(menu).toBeVisible();
    await menu.locator("[data-testid='toolbar-menu-item']").filter({ hasText: /shell/ }).first().click();
    await page.waitForFunction(
      (pid) => window.__herdr_store.getState().activePaneId === pid,
      pane3.pane_id,
      { timeout: 5000 },
    );
  });

  test("view 下拉切换对话/原始", async () => {
    await seedAgentV7();
    const { page } = ctx;
    await page.getByTestId("toolbar-view").click();
    const menu = page.getByTestId("toolbar-menu");
    await expect(menu).toBeVisible();
    await menu.locator("[data-testid='toolbar-menu-item']").filter({ hasText: /原始/ }).click();
    await expect(page.locator(".reader-card .ansi")).toBeVisible();
    await page.getByTestId("toolbar-view").click();
    await page.getByTestId("toolbar-menu").locator("[data-testid='toolbar-menu-item']").filter({ hasText: /对话/ }).click();
    await expect(page.getByTestId("chat-immersive")).toBeVisible();
  });

  test("attach 插入 @路径；model 下拉发送 /model", async () => {
    await seedAgentV7();
    const { page, pane2 } = ctx;
    await page.getByTestId("toolbar-attach").click();
    const menu = page.getByTestId("toolbar-menu");
    await expect(menu).toBeVisible();
    await menu.locator("[data-testid='toolbar-menu-item']").filter({ hasText: /sample\\.md/ }).first().click();
    await expect(page.locator(".composer textarea")).toHaveValue(/@.*sample\\.md/);
    await page.getByTestId("toolbar-model").click();
    const item = page.getByTestId("toolbar-menu").locator("[data-testid='toolbar-menu-item']").first();
    const text = await item.textContent();
    const modelName = (text.match(/([\\w.\\-]+)$/) || [])[1] || "x";
    await item.click();
    await page.waitForFunction(
      ([pid, m]) => {
        const s = window.__herdr_store.getState();
        const o = s.outputs[pid];
        return !!(o && o.text.includes(m));
      },
      [pane2.pane_id, modelName],
      { timeout: 8000 },
    );
  });
});

test.describe("F6 thinking live", () => {
  test("working 期：thinking 合并为单行实时行 + spinner", async () => {
    await seedAgentV7();
    const { page, sock, pane2 } = ctx;
    await api.paneSendInput(
      sock,
      pane2.pane_id,
      'echo "Thought for 3s (ctrl+o to expand)"; echo "Thought for 5s (ctrl+o to expand)"',
    );
    await page.waitForTimeout(1200);
    const live = page.getByTestId("thinking-live");
    await expect(live).toBeVisible();
    await expect(page.getByTestId("thinking-spinner")).toBeVisible();
    expect(await page.getByTestId("thinking-row").count()).toBeLessThanOrEqual(1);
  });

  test("turn 结束后 spinner 移除，定格思考 Ns", async () => {
    await seedAgentV7();
    const { page, sock, pane2 } = ctx;
    await page.getByTestId("thinking-live").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "idle");
    await page.waitForFunction(
      () => {
        const s = window.__herdr_store.getState();
        return s.agents.some((a) => ["idle", "done"].includes(a.agent_status));
      },
      null,
      { timeout: 10000 },
    );
    await page.waitForTimeout(800);
    await expect(page.getByTestId("thinking-spinner")).toHaveCount(0);
    const live = page.getByTestId("thinking-live");
    if (await live.count()) {
      await expect(live).toContainText(/思考|Thought/);
    }
  });
});

test.describe("F7 smoothness", () => {
  test("spinner 是纯 CSS 动画", async () => {
    await seedAgentV7();
    const { page } = ctx;
    await page.getByTestId("thinking-live").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    const spinner = page.getByTestId("thinking-spinner");
    await expect(spinner).toBeVisible();
    const name = await spinner.evaluate((el) => getComputedStyle(el).animationName);
    expect(name).not.toBe("none");
  });

  test("时钟组件隔离：pane 文本更新不重挂载时钟", async () => {
    await seedAgentV7();
    const { page, sock, pane2 } = ctx;
    await page.evaluate(() => {
      const el = document.querySelector(".turn-time");
      if (el) (window).__v7clock = el;
      return !!el;
    });
    const marker = "V7JANK_" + Date.now();
    await api.paneSendInput(sock, pane2.pane_id, `echo ${marker}`);
    await page.waitForFunction(
      (m) => {
        const s = window.__herdr_store.getState();
        const o = s.outputs[s.activePaneId];
        return !!(o && o.text.includes(m));
      },
      marker,
      { timeout: 8000 },
    );
    const same = await page.evaluate(() => {
      const el = document.querySelector(".turn-time");
      return !!el && el === (window).__v7clock;
    });
    expect(same, "clock DOM node should survive text streaming").toBeTruthy();
  });
});
'''
    open(spec_path, 'w', encoding='utf-8').write(spec + addition)
    print('spec appended')
