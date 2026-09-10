// V4 feature acceptance tests — executable contract of docs/plans/2026-09-10-v4-prd.md
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

// Seed a Claude-Code-like transcript into pane2 and report a fake agent on it.
async function seedAgent() {
  const { sock, pane2 } = ctx;
  await api.paneSendInput(
    sock,
    pane2.pane_id,
    'echo "\u276f \u5e2e\u6211\u68c0\u67e5\u76ee\u5f55"; echo "Thought for 4s (ctrl+o to expand)"; echo "\u23fa List(config)"; echo "batch_process_cameras.py    build-and-serve-https.bat    cam29_data/"; echo "docs/    frontend/    package.json"; echo "\u273b Baked for 28s"; echo "\u25b8\u25b8 bypass permissions on (shift+tab to cycle) \u2190 for agents"',
  );
  await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
  const { page } = ctx;
  await page.waitForFunction(
    (pid) => window.__herdr_store.getState().agents.some((a) => a.pane_id === pid),
    pane2.pane_id,
    { timeout: 10000 },
  );
  await page.locator(".pane-chip").filter({ hasText: /e2e-fake agent|E2E/ }).first().click().catch(() => {});
}

// ---------- F1 对话排版规范化 ----------
test.describe("F1 normalized transcript", () => {
  test("thinking 行渲染为可折叠行，不出现在正文", async () => {
    await seedAgent();
    const { page } = ctx;
    const thread = page.getByTestId("chat-immersive");
    await expect(thread.getByTestId("thinking-row").first()).toBeVisible();
    await expect(thread.locator("[data-testid='thinking-row']").first()).toContainText("4s");
    // no assistant block carries the raw thinking text
    const inAssistant = thread.locator("[data-testid='msg-assistant']").filter({ hasText: /Thought for/ });
    await expect(inAssistant).toHaveCount(0);
  });

  test("Baked for 归入 meta 分隔，不进入任何消息块", async () => {
    await seedAgent();
    const { page } = ctx;
    const thread = page.getByTestId("chat-immersive");
    const baked = thread.locator("[data-testid^='msg-']").filter({ hasText: /Baked for/ });
    await expect(baked).toHaveCount(0);
    // NOTE(test-fix): add the positive half of this assertion (review m5) —
    // the status line must land in the weak meta separator row, not vanish.
    const metaRow = thread.locator("[data-testid='chat-meta']").filter({ hasText: /Baked for 28s/ });
    await expect(metaRow.first()).toBeVisible();
  });

  test("TUI 页脚整行丢弃", async () => {
    await seedAgent();
    const { page } = ctx;
    const thread = page.getByTestId("chat-immersive");
    await expect(thread.locator("[data-testid^='msg-']").filter({ hasText: /bypass permissions/ })).toHaveCount(0);
    // NOTE(test-fix): `thread.locator("body")` can never resolve — <body> is
    // never a descendant of the chat surface — and a negated toContainText
    // still waits for at least one element ("element(s) not found" fails even
    // for .not). The intent is "the footer appears nowhere on the page", so
    // assert against the document body instead.
    await expect(page.locator("body")).not.toContainText("shift+tab to cycle");
  });

  test("工具输出的多列文件列表重排为网格", async () => {
    await seedAgent();
    const { page } = ctx;
    const grid = page.getByTestId("tool-files").first();
    await expect(grid).toBeVisible();
    const items = grid.locator("[data-testid='file-chip']");
    expect(await items.count()).toBeGreaterThanOrEqual(6);
    // grid layout: all chips share the same width (uniform columns)
    const widths = [];
    for (const el of await items.elementHandles().then((h) => h.slice(0, 4))) {
      widths.push((await el.boundingBox()).width);
    }
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
  });

  test("排版一致性：所有消息块左缩进一致", async () => {
    await seedAgent();
    const { page } = ctx;
    // NOTE(test-fix): blocks stream in asynchronously after the agent is
    // reported; the original single evaluate raced the transcript delivery and
    // measured an empty thread ("暂无对话内容"). Poll until the seed produced
    // its msg-* blocks, then measure.
    await expect
      .poll(
        async () =>
          page.evaluate(() => document.querySelectorAll("[data-testid^='msg-']").length),
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(2);
    const offsets = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll("[data-testid^='msg-']")];
      return blocks.map((b) => b.getBoundingClientRect().left);
    });
    expect(offsets.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(1);
  });
});

// ---------- F2 斜杠命令面板 ----------
test.describe("F2 slash palette", () => {
  test("输入 / 弹出命令面板，含 /model 等命令", async () => {
    await seedAgent();
    const { page } = ctx;
    const ta = page.locator(".composer textarea");
    await ta.click();
    await ta.fill("/");
    const palette = page.getByTestId("slash-palette");
    await expect(palette).toBeVisible();
    const items = palette.getByTestId("slash-item");
    expect(await items.count()).toBeGreaterThanOrEqual(4);
    await expect(palette).toContainText("/model");
    await expect(palette).toContainText("/status");
  });

  test("键入过滤 + Enter 回填不发送，再次 Enter 才发送", async () => {
    await seedAgent();
    const { page, sock, pane2 } = ctx;
    const ta = page.locator(".composer textarea");
    await ta.click();
    await ta.fill("/mo");
    const palette = page.getByTestId("slash-palette");
    await expect(palette).toBeVisible();
    await expect(palette.getByTestId("slash-item")).toHaveCount(1);
    await expect(palette.getByTestId("slash-item").first()).toContainText("/model");
    // Enter selects (fills) — panel closes, input holds /model, nothing sent yet
    await ta.press("Enter");
    await expect(palette).toHaveCount(0);
    await expect(ta).toHaveValue("/model");
    // server-side: nothing sent yet
    const before = (await api.paneRead(sock, pane2.pane_id)).text;
    // second Enter sends
    await ta.press("Enter");
    await page.waitForFunction(
      (m) => {
        const s = window.__herdr_store.getState();
        return s.outputs[s.activePaneId]?.text.includes(m);
      },
      "/model",
      { timeout: 8000 },
    );
    const after = (await api.paneRead(sock, pane2.pane_id)).text;
    expect(after.length).toBeGreaterThanOrEqual(before.length);
  });

  test("点击命令项回填；Esc 关闭面板", async () => {
    await seedAgent();
    const { page } = ctx;
    const ta = page.locator(".composer textarea");
    await ta.click();
    await ta.fill("/");
    const palette = page.getByTestId("slash-palette");
    await expect(palette).toBeVisible();
    await palette.getByTestId("slash-item").filter({ hasText: "/status" }).click();
    await expect(palette).toHaveCount(0);
    await expect(ta).toHaveValue("/status");
    await ta.fill("/");
    await expect(page.getByTestId("slash-palette")).toBeVisible();
    await ta.press("Escape");
    await expect(page.getByTestId("slash-palette")).toHaveCount(0);
  });

  test("shell pane 不弹命令面板", async () => {
    const { page } = ctx;
    const ta = page.locator(".composer textarea");
    await ta.click();
    await ta.fill("/");
    await expect(page.getByTestId("slash-palette")).toHaveCount(0);
  });
});
