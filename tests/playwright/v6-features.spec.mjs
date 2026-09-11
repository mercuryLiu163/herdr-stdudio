// V6 feature acceptance tests — executable contract of docs/plans/2026-09-12-v6-prd.md
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

// Seed the exact transcript patterns from the user's "still ugly" screenshot.
async function seedAgent() {
  const { sock, pane2 } = ctx;
  await api.paneSendInput(
    sock,
    pane2.pane_id,
    'echo "123"; echo "\u25cf Looks like a test or accidental input \u2014 no problem."; echo "Let me know what you would like to work on whenever you are ready."; echo "\u2514 Set model to glm-5.2 and saved as your default for new sessions"',
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

// ---------- F1 排版去卡片化 ----------
test.describe("F1 de-card typography", () => {
  test("assistant 正文用无衬线字体，等宽仅限代码", async () => {
    await seedAgent();
    const { page } = ctx;
    const thread = page.getByTestId("chat-immersive");
    await expect(thread.getByTestId("msg-assistant").first()).toBeVisible();
    const fonts = await page.evaluate(() => {
      const blocks = [...document.querySelectorAll("[data-testid='msg-assistant']")];
      return blocks.map((b) => getComputedStyle(b).fontFamily.toLowerCase());
    });
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) {
      expect(f.includes("cascadia") || f.includes("consolas") || f.includes("mono")).toBeFalsy();
    }
  });

  test("turn-header 无边框无盒底", async () => {
    await seedAgent();
    const { page } = ctx;
    const header = page.getByTestId("turn-header").first();
    await expect(header).toBeVisible();
    const styles = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderTopWidth: s.borderTopWidth, bg: s.backgroundColor };
    });
    expect(parseFloat(styles.borderTopWidth)).toBe(0);
    // transparent or near-transparent background (no gray box)
    const rgba = styles.bg.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\)/);
    if (rgba) {
      const alpha = rgba[4] === undefined ? 1 : parseFloat(rgba[4]);
      expect(alpha).toBeLessThan(0.06);
    }
  });

  test("工具行紧凑单行：无全宽横幅盒，点击展开详情", async () => {
    await seedAgent();
    const { page } = ctx;
    const tool = page.getByTestId("msg-tool").first();
    await expect(tool).toBeVisible();
    const box = await tool.boundingBox();
    const styles = await tool.evaluate((el) => {
      const s = getComputedStyle(el);
      return { h: el.getBoundingClientRect().height, bw: s.borderTopWidth };
    });
    void box;
    expect(styles.h).toBeLessThanOrEqual(32);
    expect(parseFloat(styles.bw)).toBe(0);
  });

  test("user 气泡中性底色", async () => {
    await seedAgent();
    const { page } = ctx;
    const bubble = page.getByTestId("msg-user").first();
    await expect(bubble).toBeVisible();
    const bg = await bubble.evaluate((el) => getComputedStyle(el).backgroundColor);
    // surface-raised #30302e ≈ rgb(48,48,46) — neutral: r≈g≈b within 6
    const m = bg.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    expect(m, "bubble bg should be rgb: " + bg).toBeTruthy();
    const [, r, g, b] = m.map(Number);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(6);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(6);
  });

  test("间距收紧：turn 头部与正文贴合", async () => {
    await seedAgent();
    const { page } = ctx;
    const header = page.getByTestId("turn-header").first();
    const body = page.getByTestId("chat-immersive").locator("[data-testid='msg-tool'], [data-testid='msg-assistant']").first();
    const gap = await page.evaluate(
      ([h, b]) => {
        const hb = document.querySelectorAll("[data-testid='turn-header']")[0].getBoundingClientRect();
        const bb = document.querySelector("[data-testid='msg-tool'], [data-testid='msg-assistant']")?.getBoundingClientRect();
        return bb ? bb.top - hb.bottom : null;
      },
      [header, body],
    );
    expect(gap).not.toBeNull();
    expect(gap).toBeLessThanOrEqual(10);
  });
});

// ---------- F2 解析质量 ----------
test.describe("F2 parser quality", () => {
  test("散文不再被误分类为工具（无 Looks 芯片）", async () => {
    await seedAgent();
    const { page } = ctx;
    const thread = page.getByTestId("chat-immersive");
    await expect(thread.locator("[data-testid='tool-chip']").filter({ hasText: /^Looks$/ })).toHaveCount(0);
    await expect(thread.getByTestId("msg-assistant").filter({ hasText: /Looks like a test/ }).first()).toBeVisible();
  });

  test("树形字符剥离：└ 不出现，正文保留", async () => {
    await seedAgent();
    const { page } = ctx;
    const thread = page.getByTestId("chat-immersive");
    await expect(thread.getByTestId("msg-assistant").filter({ hasText: /Set model to glm-5.2/ }).first()).toBeVisible();
    await expect(thread.locator("[data-testid^='msg-']").filter({ hasText: /└/ })).toHaveCount(0);
  });
});
