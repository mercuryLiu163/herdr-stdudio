// V3 feature acceptance tests — executable contract of docs/plans/2026-09-10-v3-prd.md
import { test, expect } from "@playwright/test";
import { launchStudio } from "./fixtures.mjs";
import { api } from "../helpers/herdr-api.mjs";

let ctx;

test.beforeEach(async () => {
  ctx = await launchStudio();
});

test.afterEach(async () => {
  await ctx.close();
  ctx = null;
});

// ---------- F1 工作区与标签合并 ----------
test.describe("F1 merged sidebar", () => {
  test("标签列消失，标签成为工作区的展开子项", async () => {
    const { page } = ctx;
    await expect(page.locator(".tabcol")).toHaveCount(0);
    const wsItem = page.locator(".ws-item").first();
    await expect(wsItem).toBeVisible();
    // current workspace auto-expanded → its tabs visible as sub rows
    const tabs = page.locator(".ws-item .tab-item, .sidebar .tab-item");
    await expect(tabs.first()).toBeVisible();
  });

  test("展开/折叠切换，点击标签子行切换 activeTab", async () => {
    const { page } = ctx;
    // find the seeded workspace E2E-WS-A and expand it
    const wsRow = page.locator(".ws-item").filter({ hasText: "E2E-WS-A" });
    await wsRow.locator("[data-testid='ws-expand']").click();
    const expanded = await wsRow.locator("[data-testid='ws-expand']").getAttribute("aria-expanded");
    // collapse then expand again to see flip
    await wsRow.locator("[data-testid='ws-expand']").click();
    await expect(wsRow.locator("[data-testid='ws-expand']")).toHaveAttribute("aria-expanded", /^(false|0)$/);
    await wsRow.locator("[data-testid='ws-expand']").click();
    await expect(wsRow.locator("[data-testid='ws-expand']")).toHaveAttribute("aria-expanded", /^(true|1)$/);
    void expanded;
    // click tab sub row → activeTab switches
    await wsRow.locator(".tab-item").filter({ hasText: "E2E-TAB-2" }).click();
    await page.waitForFunction(
      (tid) => window.__herdr_store.getState().activeTabId === tid,
      ctx.tab2.tab_id,
      { timeout: 5000 },
    );
    await expect(wsRow.locator(".tab-item").filter({ hasText: "E2E-TAB-2" })).toHaveClass(/active/);
  });
});

// ---------- F2 沉浸式对话流 ----------
test.describe("F2 immersive chat", () => {
  async function seedAgentTranscript() {
    const { sock, pane2 } = ctx;
    // markdown + tool + image path + plain text
    await api.paneSendInput(
      sock,
      pane2.pane_id,
      'echo "\u276f 帮我生成报告"; echo "\u23fa 运行 npm test"; echo "报告包含 **加粗结论** 与图片 tests/fixtures/sample.png"; echo "```js"; echo "const x = 1;"; echo "```"',
    );
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
  }

  function selectAgentPane() {
    const { page } = ctx;
    return page
      .locator(".pane-chip")
      .filter({ hasText: /e2e-fake agent|E2E/ })
      .first()
      .click()
      .catch(() => {});
  }

  test("沉浸式表面：无 reader-card 包裹，消息原生渲染", async () => {
    await seedAgentTranscript();
    await selectAgentPane();
    const { page } = ctx;
    const surface = page.getByTestId("chat-immersive");
    await expect(surface).toBeVisible();
    // immersive: the thread is not wrapped inside .reader-card
    await expect(surface.locator("xpath=ancestor::*[contains(@class,'reader-card')]")).toHaveCount(0);
  });

  test("assistant 正文按 markdown 渲染，代码块有着色", async () => {
    await seedAgentTranscript();
    await selectAgentPane();
    const { page } = ctx;
    const thread = page.getByTestId("chat-immersive");
    await expect(thread.getByTestId("msg-assistant").first()).toBeVisible();
    await expect(thread.getByTestId("msg-assistant").first()).toContainText("加粗结论");
    await expect(thread.getByTestId("msg-assistant").first().locator("strong")).toHaveText(/加粗结论/);
    const code = thread.getByTestId("msg-code").first();
    await expect(code).toBeVisible();
    await expect(code.locator("code, pre")).toBeVisible();
  });

  test("工具行渲染为彩色标签 chip", async () => {
    await seedAgentTranscript();
    await selectAgentPane();
    const { page } = ctx;
    const chip = page.getByTestId("chat-immersive").getByTestId("tool-chip").first();
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("npm");
  });

  test("图片路径渲染为内联图片", async () => {
    await seedAgentTranscript();
    await selectAgentPane();
    const { page } = ctx;
    await expect(page.getByTestId("chat-immersive").getByTestId("chat-image").first()).toBeVisible();
  });

  test("流式更新：新输出到达后线程 ≤2.5s 追加", async () => {
    await seedAgentTranscript();
    await selectAgentPane();
    const { page, sock, pane2 } = ctx;
    const marker = "PW_STREAM_" + Date.now();
    await page.waitForTimeout(1200);
    const t0 = Date.now();
    await api.paneSendInput(sock, pane2.pane_id, `echo "${marker}"`);
    await page.waitForFunction(
      (m) => {
        const s = window.__herdr_store.getState();
        const o = s.outputs[s.activePaneId];
        return !!(o && o.text.includes(m));
      },
      marker,
      { timeout: 2500 },
    );
    const latency = Date.now() - t0;
    expect(latency).toBeLessThanOrEqual(2500);
  });
});

// ---------- F3 统一模式：性能/输入目标/高亮 ----------
test.describe("F3 unified mode", () => {
  test("输入目标下拉存在且含全部 pane，发送落在目标 pane", async () => {
    const { page, sock, pane2, pane3 } = ctx;
    await page.getByTestId("layout-unified").click();
    const select = page.getByTestId("input-target");
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    expect(options.length).toBeGreaterThanOrEqual(2);
    // pick pane3 as target (by value), send, assert marker lands in pane3
    await select.selectOption({ index: 1 });
    const target = await select.inputValue();
    const marker = "PW_TARGET_" + Date.now();
    await page.locator(".composer textarea").fill(`echo ${marker}`);
    await page.locator(".composer textarea").press("Enter");
    await page.waitForFunction(
      ([pid, m]) => {
        const s = window.__herdr_store.getState();
        const o = s.outputs[pid];
        return !!(o && o.text.includes(m));
      },
      [target, marker],
      { timeout: 8000 },
    );
    void pane2; void pane3; void sock;
  });

  test("点击 cell 选中并高亮，下拉同步", async () => {
    const { page, pane3 } = ctx;
    await page.getByTestId("layout-unified").click();
    const cell = page.locator(`[data-testid='mosaic-pane-${pane3.pane_id}']`);
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(cell).toHaveAttribute("data-selected", "true");
    await expect(cell).toHaveClass(/mosaic-pane-selected/);
    const select = page.getByTestId("input-target");
    await expect(select).toHaveValue(pane3.pane_id);
  });

  test("cell 输出更新延迟 ≤2.5s（性能冒烟）", async () => {
    const { page, sock, pane3 } = ctx;
    await page.getByTestId("layout-unified").click();
    const marker = "PW_UNI_" + Date.now();
    const t0 = Date.now();
    await api.paneSendInput(sock, pane3.pane_id, `echo ${marker}`);
    await page.waitForFunction(
      ([pid, m]) => {
        const el = document.querySelector(`[data-testid='mosaic-pane-${pid}']`);
        return !!(el && el.textContent.includes(m));
      },
      [pane3.pane_id, marker],
      { timeout: 2500 },
    );
    expect(Date.now() - t0).toBeLessThanOrEqual(2600);
  });

  test("拖拽分隔条仍工作（回归）", async () => {
    const { page } = ctx;
    await page.getByTestId("layout-unified").click();
    const cells = page.locator("[data-testid^='mosaic-pane-']");
    await expect(cells).toHaveCount(2);
    const boxBefore = await cells.first().boundingBox();
    const splitter = page.locator("[data-testid^='splitter-']").first();
    const sbox = await splitter.boundingBox();
    await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sbox.x + sbox.width / 2 + 60, sbox.y + sbox.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const boxAfter = await cells.first().boundingBox();
    expect(
      Math.abs(boxAfter.width - boxBefore.width) > 8 ||
        Math.abs(boxAfter.height - boxBefore.height) > 8,
      "cell size should change after drag",
    ).toBeTruthy();
  });
});
