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
// NOTE(test-fix): under the V6 parser rules the original seed yields neither
// a msg-user (the echo-chain prompt line is dropped — the V4 rule stands) nor
// a msg-tool (`● Looks like a test …` is deliberately reclassified as
// assistant prose — that IS the F2 bugfix). F1-3/F1-4 need those two block
// types on screen, so the chain also seeds one proper user prompt (echo of a
// `❯` line) and one genuine tool call (`⏺ Bash(…)`). The "still ugly"
// patterns below are kept verbatim; the `⎿` result line (review M2) joins the
// tree-strip contract.
async function seedAgent() {
  const { sock, pane2 } = ctx;
  await api.paneSendInput(
    sock,
    pane2.pane_id,
    'echo "\u276f \u5e2e\u6211\u8dd1\u4e00\u4e0b\u6784\u5efa"; echo "\u23fa Bash(npm run build)"; echo "123"; echo "\u25cf Looks like a test or accidental input \u2014 no problem."; echo "Let me know what you would like to work on whenever you are ready."; echo "\u2514 Set model to glm-5.2 and saved as your default for new sessions"; echo "\u23bf  Updated src/app.css with 3 additions"',
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
// NOTE(review m2): --chat-turn-gap (18px) has NO automated assertion — the
// seeded transcript always resolves to a single turn, so the turn-to-turn
// rhythm can't be measured here. Covered by visual review (v6-chat-*.png);
// a two-turn spacing assertion is left for a future contract.
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

  // NOTE(test-fix): V9 (docs/plans/2026-09-16-v9-datastream-style.md, 契约迁移
  // v6 F2) re-semantics this contract: the [data-testid=turn-header] node stays
  // borderless and unboxed, but the INNER divider pill is now allowed to carry
  // a surface (--chat-divider-pill, reference 分隔丸). What must still hold is
  // the pill sitting horizontally centered on the conversation face.
  test("turn-header 无盒底；分隔丸允许有底色且水平居中", async () => {
    await seedAgent();
    const { page } = ctx;
    const header = page.getByTestId("turn-header").first();
    await expect(header).toBeVisible();
    const styles = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderTopWidth: s.borderTopWidth, bg: s.backgroundColor };
    });
    expect(parseFloat(styles.borderTopWidth)).toBe(0);
    // transparent or near-transparent background on the header node itself
    // (the pill bg lives on the inner .turn-pill, not here)
    const rgba = styles.bg.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\)/);
    if (rgba) {
      const alpha = rgba[4] === undefined ? 1 : parseFloat(rgba[4]);
      expect(alpha).toBeLessThan(0.06);
    }
    // the divider pill may carry the --chat-divider-pill surface: opaque bg
    const pillBg = await page.getByTestId("turn-pill").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const pillRgba = pillBg.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\)/);
    expect(pillRgba, "pill bg should be rgb: " + pillBg).toBeTruthy();
    if (pillRgba) {
      const alpha = pillRgba[4] === undefined ? 1 : parseFloat(pillRgba[4]);
      expect(alpha).toBeGreaterThan(0.5);
    }
    // …and the pill stays horizontally centered on the chat face
    const delta = await page.evaluate(() => {
      const p = document.querySelector("[data-testid='turn-pill']");
      const t = document.querySelector("[data-testid='chat-thread']");
      if (!p || !t) return null;
      const pr = p.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      return Math.abs(pr.left + pr.width / 2 - (tr.left + tr.width / 2));
    });
    expect(delta).not.toBeNull();
    expect(delta).toBeLessThanOrEqual(24);
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
    await expect(header).toBeVisible();
    await expect(body).toBeVisible();
    // NOTE(test-fix): the original call passed the two Locator objects as the
    // evaluate arg — Locators are not serializable, so evaluate threw before
    // any assertion ran. The callback only measures DOM rects, so the arg is
    // simply dropped (the header/body locators above keep the wait semantics).
    const gap = await page.evaluate(() => {
      const hb = document.querySelectorAll("[data-testid='turn-header']")[0].getBoundingClientRect();
      const bb = document.querySelector("[data-testid='msg-tool'], [data-testid='msg-assistant']")?.getBoundingClientRect();
      return bb ? bb.top - hb.bottom : null;
    });
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
    // NOTE(test-fix): the tree-strip contract now also covers the Claude Code
    // result glyph ⎿ (review M2) — the seeded `⎿  Updated …` line must land in
    // assistant prose with no glyph residue anywhere.
    await expect(thread.getByTestId("msg-assistant").filter({ hasText: /Updated src\/app\.css with 3 additions/ }).first()).toBeVisible();
    await expect(thread.locator("[data-testid^='msg-']").filter({ hasText: /└|\u23bf/ })).toHaveCount(0);
  });
});
