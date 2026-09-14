// V8 — Grok splash chrome, composer status, image attach
import { test, expect } from "@playwright/test";
import { launchStudio, FIXTURES } from "./fixtures.mjs";
import { api } from "../helpers/herdr-api.mjs";
import * as path from "node:path";

let ctx;

test.beforeEach(async () => {
  ctx = await launchStudio();
});

test.afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

async function seedGrokSplash() {
  const { sock, pane2, page } = ctx;
  await page.getByTestId("layout-separate").click();
  await api.paneSendInput(
    sock,
    pane2.pane_id,
    [
      'echo "Grok Build 1.0.30 | Thanks for trying Grok Build, give feedback with /feedback!"',
      'echo "New worktree ctrl+w | Resume session ctrl+r | Changelog"',
      'echo "Quit ctrl+q"',
      'echo "\u2800\u2800\u28ff\u28ff\u28ff\u28ff splash art"',
      'echo "Grok 4.6 (medium) \u00b7 always-approve"',
      'echo "Shift+Tab:mode  |  Ctrl+x:shortcuts"',
      'echo "\u276f hello grok splash"',
      'echo "real assistant line from grok"',
    ].join("; "),
  );
  await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
  await page.waitForFunction(
    (pid) => window.__herdr_store.getState().agents.some((a) => a.pane_id === pid),
    pane2.pane_id,
    { timeout: 10000 },
  );
  await page.locator(".pane-chip").filter({ hasText: /e2e-fake agent|E2E/ }).first().click().catch(() => {});
  await page.getByTestId("view-chat").click().catch(() => {});
}

test.describe("F1 Grok splash is not conversation", () => {
  test("欢迎页与 braille 乱码不进入对话块", async () => {
    await seedGrokSplash();
    const { page } = ctx;
    const thread = page.getByTestId("chat-thread");
    await expect(thread.getByTestId("msg-user").first()).toContainText("hello grok splash");
    await expect(thread.getByTestId("msg-assistant").filter({ hasText: /real assistant line/ })).toBeVisible();
    await expect(thread.locator("[data-testid^='msg-']").filter({ hasText: /Grok Build/ })).toHaveCount(0);
    await expect(thread.locator("[data-testid^='msg-']").filter({ hasText: /New worktree/ })).toHaveCount(0);
    await expect(thread.locator("[data-testid^='msg-']").filter({ hasText: /always-approve/ })).toHaveCount(0);
    await expect(thread.locator("[data-testid^='msg-']").filter({ hasText: /Quit ctrl/ })).toHaveCount(0);
  });
});

test.describe("F2 composer status", () => {
  test("模型与 always-approve 显示在底部输入框", async () => {
    await seedGrokSplash();
    const { page } = ctx;
    const bar = page.getByTestId("composer-status");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("composer-model")).toContainText("Grok 4.6");
    await expect(page.getByTestId("composer-effort")).toContainText("Medium");
    await expect(page.getByTestId("composer-mode")).toContainText("Bypass");
    await expect(page.getByTestId("chat-thread").locator("[data-testid='msg-assistant']").filter({ hasText: /always-approve/ })).toHaveCount(0);
    await page.getByTestId("composer-mode").click();
    const menu = page.getByTestId("composer-mode-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("/always-approve");
    await expect(menu).toContainText("Ask");
    await expect(menu).toContainText("Bypass");
  });

  test("统一模式同样显示底栏配置与输入目标", async () => {
    await seedGrokSplash();
    const { page } = ctx;
    await page.getByTestId("layout-unified").click();
    await expect(page.getByTestId("composer-status")).toBeVisible();
    await expect(page.getByTestId("composer-model")).toContainText("Grok 4.6");
    await expect(page.getByTestId("composer-mode")).toContainText("Bypass");
    await expect(page.getByTestId("input-target")).toBeVisible();
    await expect(page.getByTestId("composer-attach")).toBeVisible();
  });
});

test.describe("F3 image attach", () => {
  test("composer 可选择图片并随 prompt 发送路径", async () => {
    const { sock, pane2, page } = ctx;
    await page.getByTestId("layout-separate").click();
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "idle");
    await page.waitForFunction(
      (pid) => window.__herdr_store.getState().agents.some((a) => a.pane_id === pid),
      pane2.pane_id,
      { timeout: 10000 },
    );
    await page.locator(".pane-chip").filter({ hasText: /e2e-fake agent|E2E/ }).first().click().catch(() => {});

    const attach = page.getByTestId("composer-attach");
    await expect(attach).toBeVisible();
    const png = path.join(FIXTURES, "sample.png");
    await page.getByTestId("composer-file-input").setInputFiles(png);
    await expect(page.getByTestId("composer-att")).toHaveCount(1);

    const marker = `STUDIO_IMG_${Date.now().toString(36)}`;
    const ta = page.locator(".composer textarea");
    await ta.fill(marker);
    await ta.press("Enter");

    await expect.poll(async () => {
      const read = await api.paneRead(sock, pane2.pane_id);
      const blob = JSON.stringify(read);
      return blob.includes(marker) && /sample\.png/i.test(blob);
    }, { timeout: 12_000 }).toBe(true);
  });
});
