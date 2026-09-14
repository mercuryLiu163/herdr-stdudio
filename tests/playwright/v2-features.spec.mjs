// V2 feature acceptance tests — the executable contract of docs/plans/2026-09-09-v2-prd.md
// These are written BEFORE implementation (TDD red); the implementer makes them green.
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

// ---------- F1 日夜模式 ----------
test.describe("F1 theme toggle", () => {
  test("默认 dark，点击切换到 light 并持久化", async () => {
    const { page } = ctx;
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await page.waitForFunction(() => !!window.__herdr_store?.getState()?.booted, null, { timeout: 20000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("light 模式下 reader 卡片使用浅色令牌", async () => {
    const { page } = ctx;
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    );
    // ChatGPT-light surface: near-white
    expect(bg.toLowerCase()).toMatch(/^(#fff|#f9|#fa|white)/);
  });
});

// ---------- F2 右侧功能栏 ----------
test.describe("F2 right sidebar", () => {
  test("开关右侧栏并显示当前 cwd 的文件树", async () => {
    const { page } = ctx;
    await page.getByTestId("right-sidebar-toggle").click();
    await expect(page.getByTestId("right-sidebar")).toBeVisible();
    // The active pane's cwd is tests/fixtures (seeded), so sample files appear.
    const tree = page.getByTestId("file-tree");
    await expect(tree).toBeVisible();
    await expect
      .poll(async () => {
        const texts = await tree.getByTestId("file-item").allTextContents();
        return texts.some((t) => t.includes("sample.md"));
      })
      .toBe(true);
  });

  test("markdown 文件渲染为 HTML", async () => {
    const { page } = ctx;
    await page.getByTestId("right-sidebar-toggle").click();
    await page.getByTestId("file-tree").getByTestId("file-item").filter({ hasText: "sample.md" }).first().click();
    const preview = page.getByTestId("file-preview");
    await expect(preview.locator("h1")).toHaveText(/采样文档/);
    await expect(preview.locator("strong")).toHaveText(/加粗/);
  });

  test("图片文件显示 img，未知类型出现默认浏览器打开按钮", async () => {
    const { page } = ctx;
    await page.getByTestId("right-sidebar-toggle").click();
    await page.getByTestId("file-tree").getByTestId("file-item").filter({ hasText: "sample.png" }).first().click();
    await expect(page.getByTestId("file-preview").locator("img")).toBeVisible();

    await page.getByTestId("file-tree").getByTestId("file-item").filter({ hasText: "sample.xyz" }).first().click();
    await expect(page.getByTestId("open-external")).toBeVisible();
  });

  test("cwd 下拉列出工作区已知目录并可切换", async () => {
    const { page } = ctx;
    await page.getByTestId("right-sidebar-toggle").click();
    const select = page.getByTestId("cwd-select");
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    expect(options.join("\n")).toContain("fixtures");
  });
});

// ---------- F3 终端区双模式 ----------
test.describe("F3 layout modes", () => {
  test("默认分屏模式（V1 行为）", async () => {
    const { page } = ctx;
    await expect(page.getByTestId("layout-separate")).toHaveAttribute("aria-pressed", /true|1/);
    await expect(page.getByTestId("mosaic")).toHaveCount(0);
  });

  test("统一模式：全部 pane 拼装且各自内容独立", async () => {
    const { page, sock, pane2, pane3 } = ctx;
    const m1 = "PW_M1_" + Date.now();
    const m2 = "PW_M2_" + Date.now();
    await api.paneSendInput(sock, pane2.pane_id, `echo ${m1}`);
    await api.paneSendInput(sock, pane3.pane_id, `echo ${m2}`);
    await page.getByTestId("layout-unified").click();
    const mosaic = page.getByTestId("mosaic");
    await expect(mosaic).toBeVisible();
    const cells = mosaic.locator("[data-testid^='mosaic-pane-']");
    await expect(cells).toHaveCount(2);
    await expect(mosaic.locator(`[data-testid='mosaic-pane-${pane2.pane_id}']`)).toContainText(m1);
    await expect(mosaic.locator(`[data-testid='mosaic-pane-${pane3.pane_id}']`).first()).toContainText(m2, { timeout: 15000 });
  });

  test("拖动分隔条改变相邻 cell 尺寸", async () => {
    const { page } = ctx;
    await page.getByTestId("layout-unified").click();
    const cells = page.locator("[data-testid^='mosaic-pane-']");
    await expect(cells).toHaveCount(2);
    const boxBefore = await cells.first().boundingBox();
    const splitter = page.locator("[data-testid^='splitter-']").first();
    await expect(splitter).toBeVisible();
    const sbox = await splitter.boundingBox();
    // drag splitter 60px to the right (fallback: vertical layout → down)
    await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sbox.x + sbox.width / 2 + 60, sbox.y + sbox.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const boxAfter = await cells.first().boundingBox();
    const grew =
      Math.abs(boxAfter.width - boxBefore.width) > 8 ||
      Math.abs(boxAfter.height - boxBefore.height) > 8;
    expect(grew, `cell size should change after splitter drag: before=${JSON.stringify(boxBefore)} after=${JSON.stringify(boxAfter)}`).toBeTruthy();
  });

  test("切回分屏恢复 V1 视图", async () => {
    const { page } = ctx;
    await page.getByTestId("layout-unified").click();
    await expect(page.getByTestId("mosaic")).toBeVisible();
    await page.getByTestId("layout-separate").click();
    await expect(page.getByTestId("mosaic")).toHaveCount(0);
    await expect(page.getByTestId("reader-card")).toBeVisible();
  });
});

// ---------- F4 对话视图 ----------
test.describe("F4 chat view", () => {
  test("agent pane 默认对话视图，可切原始输出", async () => {
    const { page, sock, pane2 } = ctx;
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
    await page.waitForFunction(
      (pid) => window.__herdr_store.getState().agents.some((a) => a.pane_id === pid),
      pane2.pane_id,
      { timeout: 10000 },
    );
    // select pane2 via chip
    await page.locator(".pane-chip", { hasText: /agent|fake|E2E/ }).first().click().catch(() => {});
    await expect(page.getByTestId("chat-thread")).toBeVisible();
    await page.getByTestId("view-raw").click();
    await expect(page.locator(".reader-card .ansi")).toBeVisible();
    await page.getByTestId("view-chat").click();
    await expect(page.getByTestId("chat-thread")).toBeVisible();
  });

  test("合成转写解析为 user/tool/assistant 块，装饰行不出现", async () => {
    const { page, sock, pane2 } = ctx;
    await api.paneSendInput(
      sock,
      pane2.pane_id,
      'echo "\u276f 帮我检查测试"; echo "\u23fa Bash(npm test)"; echo "\u8fd0\u884c npm test"; echo "这是回复正文。"; echo "─────"',
    );
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
    await page.waitForFunction(
      (pid) => window.__herdr_store.getState().agents.some((a) => a.pane_id === pid),
      pane2.pane_id,
      { timeout: 10000 },
    );
    await page.locator(".pane-chip").filter({ hasText: /e2e-fake agent|E2E/ }).first().click().catch(() => {});
    const thread = page.getByTestId("chat-thread");
    await expect(thread).toBeVisible();
    await expect(thread.getByTestId("msg-user").first()).toContainText("帮我检查测试");
    await expect(thread.getByTestId("msg-tool").first()).toContainText("npm test");
    await expect(thread.getByTestId("msg-assistant").first()).toContainText("这是回复正文");
    // separator-only lines must not be rendered as message content
    const decorative = thread.locator("[data-testid^='msg-']").filter({ hasText: /^\s*─{3,}\s*$/ });
    await expect(decorative).toHaveCount(0);
  });

  test("空 shell 可切到原始输出视图", async () => {
    const { page } = ctx;
    await page.getByTestId("view-raw").click();
    await expect(page.getByTestId("chat-thread")).toHaveCount(0);
    await expect(page.locator(".reader-card")).toBeVisible();
  });
});
