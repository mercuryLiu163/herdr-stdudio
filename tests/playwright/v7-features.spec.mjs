// V7 — 分屏对话数据流重排（docs/plans/2026-09-13-v7-prd.md）
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

async function seedFlow() {
  const { sock, pane2, page } = ctx;
  await page.getByTestId("layout-separate").click();
  // User prompt (title + URL + list) then assistant prose with a bare URL
  // and a duration meta line. Continuation lines must join the user card;
  // "已完成" must stay assistant.
  await api.paneSendInput(
    sock,
    pane2.pane_id,
    'echo "\u276f \u8bf7\u7528\u5e94\u7528\u5185\u6d4f\u89c8\u5668\u6253\u5f00\u8fd9\u4e2a\u7f51\u9875:"; echo "URL: https://pi.dev/docs/latest"; echo "- \u622a\u56fe:\u622a\u53d6\u9875\u9762\u53ef\u89c6\u533a\u57df"; echo "\u5df2\u5b8c\u6210\u3002\u603b\u7ed3\u5982\u4e0b:"; echo "\u89c1\u6587\u6863 https://pi.dev/docs/latest"; echo "\u273b Worked for 97s"',
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

test.describe("F1 user card", () => {
  test("结构续行并入用户卡片，markdown 列表与 URL 可见", async () => {
    await seedFlow();
    const { page } = ctx;
    const user = page.getByTestId("msg-user").first();
    await expect(user).toBeVisible();
    await expect(user).toContainText("请用应用内浏览器打开这个网页");
    await expect(user.locator("li")).toHaveCount(1);
    await expect(user.locator("a").first()).toHaveAttribute("href", /https:\/\/pi\.dev/);
    const assistant = page.getByTestId("msg-assistant").filter({ hasText: /已完成/ }).first();
    await expect(assistant).toBeVisible();
    await page.screenshot({ path: "tests/artifacts/v7-chat-flow.png", fullPage: true });
  });

  test("用户卡片标题含首行，点击可折叠正文", async () => {
    await seedFlow();
    const { page } = ctx;
    const user = page.getByTestId("msg-user").first();
    const toggle = user.getByTestId("user-card-toggle");
    await expect(toggle).toContainText("请用应用内浏览器打开这个网页");
    await expect(user.locator("li")).toBeVisible();
    await toggle.click();
    await expect(user.locator("li")).toHaveCount(0);
    await toggle.click();
    await expect(user.locator("li")).toBeVisible();
  });
});

test.describe("F2 turn pill", () => {
  test("turn-pill 相对对话流水平居中", async () => {
    await seedFlow();
    const { page } = ctx;
    const pill = page.getByTestId("turn-pill").first();
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("1m 37s");
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

  test("turn-header 仍无边框无盒底", async () => {
    await seedFlow();
    const { page } = ctx;
    const header = page.getByTestId("turn-header").first();
    await expect(header).toBeVisible();
    const styles = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderTopWidth: s.borderTopWidth, bg: s.backgroundColor };
    });
    expect(parseFloat(styles.borderTopWidth)).toBe(0);
    const rgba = styles.bg.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\)/);
    if (rgba) {
      const alpha = rgba[4] === undefined ? 1 : parseFloat(rgba[4]);
      expect(alpha).toBeLessThan(0.06);
    }
  });
});

test.describe("F3 assistant document", () => {
  test("助手正文裸 URL 渲染为绿色链接 chip", async () => {
    await seedFlow();
    const { page } = ctx;
    const link = page.getByTestId("msg-assistant").locator("a[href^='https://']").first();
    await expect(link).toBeVisible();
    const rgb = await link.evaluate((el) => {
      const c = getComputedStyle(el).color;
      const m = c.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
    });
    expect(rgb).toBeTruthy();
    expect(rgb.g).toBeGreaterThan(rgb.r);
    expect(rgb.g).toBeGreaterThan(rgb.b);
  });
});

test.describe("F4 ZCODE 对话流（非 agent 的 shell 转写）", () => {
  async function seedZcode() {
    const { sock, pane2, page } = ctx;
    await page.getByTestId("layout-separate").click();
    await api.paneSendInput(
      sock,
      pane2.pane_id,
      'echo "\u25c6 ZCODE  v3.11.2-22"; echo "Ask a task about this workspace"; echo "/help commands \u00b7 /status details"; echo "> \u4f60\u597d"; echo "\u4f60\u597d\uff01\u6709\u4ec0\u4e48\u6211\u53ef\u4ee5\u5e2e\u4f60\u7684\u5417\uff1f"; echo "[ \u2713 5s ]"; echo "\u25c6 bigmodel/GLM-5.3 - \u25cf yolo - ctx 98% - cache 43%"',
    );
    await page.waitForFunction(() => {
      const s = window.__herdr_store.getState();
      const t = s.activePaneId ? s.outputs[s.activePaneId]?.text ?? "" : "";
      return t.includes("ZCODE") || t.includes("你好");
    }, null, { timeout: 10000 });
  }

  test("ZCODE shell 自动打开对话视图，不落原始输出", async () => {
    await seedZcode();
    const { page } = ctx;
    await expect(page.getByTestId("chat-thread")).toBeVisible();
    await expect(page.getByTestId("view-chat")).toHaveAttribute("aria-pressed", "true");
  });

  test("TUI 框线/页脚丢掉，用户与助手重排，时长进回合丸", async () => {
    await seedZcode();
    const { page } = ctx;
    const thread = page.getByTestId("chat-thread");
    await expect(thread.getByTestId("msg-user").first()).toContainText("你好");
    await expect(thread.getByTestId("msg-assistant").first()).toContainText("有什么我可以帮你的吗");
    await expect(thread.locator("[data-testid='tool-chip']").filter({ hasText: /ZCODE/ })).toHaveCount(0);
    await expect(thread.locator("[data-testid^='msg-']").filter({ hasText: /Ask a task about this workspace/ })).toHaveCount(0);
    await expect(thread.locator("[data-testid^='msg-']").filter({ hasText: /ctx 98%/ })).toHaveCount(0);
    await expect(page.getByTestId("turn-pill")).toContainText("5s");
  });

  test("中文问候不是工具；软换行拼回；expand) 残片丢掉", async () => {
    const { sock, pane2, page } = ctx;
    await page.getByTestId("layout-separate").click();
    await api.paneSendInput(
      sock,
      pane2.pane_id,
      'echo "> \u4f60\u597d"; echo "\u25cf \u4f60\u597d\uff01\u6709\u4ec0\u4e48\u6211\u53ef\u4ee5\u5e2e\u4f60\u7684\u5417\uff1f"; echo "expand)"; echo "\u6bd4\u5982:"; echo "\u2022 \u76f8\u673a\u6807\u5b9a\u76f8\u5173"; echo "batch_proc"; echo "ess_cameras.py"',
    );
    await page.waitForFunction(() => {
      const s = window.__herdr_store.getState();
      const t = s.activePaneId ? s.outputs[s.activePaneId]?.text ?? "" : "";
      return t.includes("batch_proc");
    }, null, { timeout: 10000 });
    const thread = page.getByTestId("chat-thread");
    await expect(thread.getByTestId("msg-user").first()).toContainText("你好");
    await expect(thread.locator("[data-testid='tool-chip']")).toHaveCount(0);
    await expect(thread.getByTestId("msg-assistant").first()).toContainText("有什么我可以帮你的吗");
    await expect(thread).not.toContainText("expand)");
    await expect(thread.getByTestId("msg-assistant").first()).toContainText(/batch_proc/);
    await expect(thread.getByTestId("msg-assistant").first()).toContainText("相机标定相关");
  });

  test("Claude 启动横幅和 Kneading/Frosting 思考草稿不进正文", async () => {
    const { sock, pane2, page } = ctx;
    await page.getByTestId("layout-separate").click();
    await api.paneSendInput(
      sock,
      pane2.pane_id,
      'echo "CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1 restores the previous wait-for-the-API behavior."; echo "Claude Code v2.1.228"; echo "glm-5.2 · API Usage Billing"; echo "E:\\\\MyCode\\\\tool-box-map-editor"; echo "> \u4f60\u597d"; echo "\u273d Kneading\u2026"; echo "The user just said hello in Chinese. This is a simple greeting. I should respond in Chinese."; echo "\u273d Frosting\u2026 (7s \u00b7 thinking)"; echo "\u4f60\u597d\uff01\u6709\u4ec0\u4e48\u6211\u53ef\u4ee5\u5e2e\u4f60\u7684\uff1f"; echo "\u273d Frosting\u2026 (running stop hook \u00b7 7s \u00b7 thinking)"; echo "Token usage: total=1"',
    );
    await page.waitForFunction(() => {
      const s = window.__herdr_store.getState();
      const t = s.activePaneId ? s.outputs[s.activePaneId]?.text ?? "" : "";
      return t.includes("Kneading") || t.includes("你好");
    }, null, { timeout: 10000 });
    const thread = page.getByTestId("chat-thread");
    await expect(thread.getByTestId("msg-user").first()).toContainText("你好");
    await expect(thread.getByTestId("msg-assistant").first()).toContainText("有什么我可以帮你的");
    await expect(thread).not.toContainText("Kneading");
    await expect(thread).not.toContainText("API Usage Billing");
    await expect(thread).not.toContainText("CLAUDE_CODE_");
    await expect(thread).not.toContainText("The user just said");
    await expect(thread).not.toContainText("stop hook");
    await expect(thread.getByTestId("thinking-row")).toBeVisible();
  });

  test("Thinking for 5s 是思考行，后面的中文是助手正文", async () => {
    const { sock, pane2, page } = ctx;
    await page.getByTestId("layout-separate").click();
    await api.paneSendInput(
      sock,
      pane2.pane_id,
      'echo "> \u4f60\u597d"; echo "Thinking for 5s... (ctrl+o to expand)"; echo "\u4f60\u597d\uff01\u53ef\u4ee5\u7ee7\u7eed\u5730\u56fe\u7f16\u8f91\u5668\u7684\u5f00\u53d1\uff0c\u6216\u8005\u5176\u5b83\u4efb\u52a1\u3002"',
    );
    await page.waitForFunction(() => {
      const s = window.__herdr_store.getState();
      const t = s.activePaneId ? s.outputs[s.activePaneId]?.text ?? "" : "";
      return t.includes("Thinking for 5s") || t.includes("其它任务") || t.includes("地图编辑器");
    }, null, { timeout: 10000 });
    const thread = page.getByTestId("chat-thread");
    await expect(thread.getByTestId("thinking-row")).toContainText("5s");
    await expect(thread.getByTestId("msg-assistant").first()).toContainText("地图编辑器");
    await expect(thread.getByTestId("msg-assistant")).not.toContainText("Thinking for");
  });

  // NOTE(test-fix): V9 (docs/plans/2026-09-16-v9-datastream-style.md, F2 用户
  // 消息两态) turns the user message into the right-aligned compact element
  // (单行=右对齐小气泡 / 多行=右对齐卡片), superseding the old "user fills the
  // stream" width contract for msg-user. The migrated contract: assistant
  // prose still fills the stream; the user message right-aligns to the
  // thread's right edge instead.
  test("对话流：助手通栏铺满，用户消息右对齐", async () => {
    const { sock, pane2, page } = ctx;
    await page.getByTestId("layout-separate").click();
    await api.paneSendInput(
      sock,
      pane2.pane_id,
      'echo "> \u6211\u6b63\u5728\u6d4b\u8bd5\u529f\u80fd"; echo "\u597d\u7684\uff0c\u6ca1\u95ee\u9898"; echo "\uff0c \u6709\u4efb\u4f55\u9700\u8981\u968f\u65f6\u8bf4"; echo "\u6bd4\u5982\u8dd1\u547d\u4ee4\u3001\u770b\u4ee3\u7801\u3001\u6539\u6587\u4ef6\u90fd\u53ef\u4ee5\u3002"',
    );
    await page.waitForFunction(() => {
      const s = window.__herdr_store.getState();
      const t = s.activePaneId ? s.outputs[s.activePaneId]?.text ?? "" : "";
      return t.includes("测试功能") || t.includes("没问题");
    }, null, { timeout: 10000 });
    // NOTE(test-fix): 上面的 waitForFunction 轮询的是 store 文本，而「对话」视图
    // 切换在其后的 React effect（AutoChatView）里落地——evaluate 偶发跑在切换
    // 完成前（失败快照显示「原始输出」仍处于按下态），chat-thread 尚未挂载导致
    // threadW=0。契约不变（铺满测量），只是先等对话视图真正挂载。
    await page.getByTestId("chat-thread").waitFor({ state: "visible", timeout: 10000 });
    const { userW, userRight, threadW, threadRight, asstW, asstText } = await page.evaluate(() => {
      const thread = document.querySelector("[data-testid='chat-thread']");
      const user = document.querySelector("[data-testid='msg-user']");
      const asst = document.querySelector("[data-testid='msg-assistant']");
      const ur = user?.getBoundingClientRect();
      const tr = thread?.getBoundingClientRect();
      return {
        userW: ur?.width ?? 0,
        userRight: ur ? ur.right : 0,
        threadW: tr?.width ?? 0,
        threadRight: tr ? tr.right : 0,
        asstW: asst?.getBoundingClientRect().width ?? 0,
        asstText: asst?.textContent ?? "",
      };
    });
    expect(threadW).toBeGreaterThan(400);
    // assistant prose keeps the full-width document flow
    expect(asstW / threadW).toBeGreaterThan(0.85);
    // user message is the compact right-aligned element (V9 F2): no longer
    // stretched, and its right edge hugs the thread's right edge
    expect(userW / threadW).toBeLessThan(0.85);
    expect(threadRight - userRight).toBeLessThanOrEqual(4);
    expect(asstText.replace(/\s+/g, "")).toContain("没问题");
    expect(asstText).toContain("随时说");
  });
});



// ---------- F5 Composer 状态栏 ----------
// NOTE(test-fix): 复审收敛（对标 mcode 参考模板）后工具条分段为
// `+ / 模型 ∨ / effort ∨ / Bypass ∨ / ◐ 环形 / agent 徽标 / 发送钮`，
// 旧 toolbar-attach / toolbar-target / toolbar-view 段已移除（见下方 NOTE）。
async function seedAgentV7(agentKind = "e2e-fake") {
  const { sock, pane2 } = ctx;
  await api.paneSendInput(
    sock,
    pane2.pane_id,
    'echo "\u276f \u5f00\u59cb\u4efb\u52a1"; echo "Thought for 2s (ctrl+o to expand)"; echo "\u23fa Edit(src/index.js)"; echo "\u5b8c\u6210\u3002"',
  );
  await api.paneReportAgent(sock, pane2.pane_id, agentKind, "working");
  const { page } = ctx;
  await page.waitForFunction(
    (pid) => window.__herdr_store.getState().agents.some((a) => a.pane_id === pid),
    pane2.pane_id,
    { timeout: 10000 },
  );
  // NOTE(test-fix): chip 文案随 agentKind 变（displayName 回退为 "<kind> agent"）
  await page
    .locator(".pane-chip")
    .filter({ hasText: new RegExp(`${agentKind} agent|E2E`) })
    .first()
    .click()
    .catch(() => {});
}

test.describe("F5 composer toolbar (V9 restyle)", () => {
  // V9: discrete rounded-outline buttons, reference screenshot parity.
  test("控件组齐全：attach/图片/模型/tools/view-chip/status/send", async () => {
    await seedAgentV7();
    const { page } = ctx;
    await expect(page.getByTestId("composer-toolbar")).toBeVisible();
    for (const id of ["toolbar-attach", "composer-attach", "toolbar-model", "tools-button", "composer-status", "send-button"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    // chat view active chip visible with dismiss ×
    const chip = page.getByTestId("view-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("对话");
  });

  test("模型下拉选择即发送 /model <名>", async () => {
    await seedAgentV7();
    const { page, pane2 } = ctx;
    await page.getByTestId("toolbar-model").click();
    const item = page.getByTestId("toolbar-menu").locator("[data-testid='toolbar-menu-item']").first();
    const text = await item.textContent();
    const modelName = (text.match(/([\w.\-]+)$/) || [])[1] || "x";
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

  test("tools 按钮打开斜杠命令面板", async () => {
    await seedAgentV7();
    const { page } = ctx;
    await page.getByTestId("tools-button").click();
    await expect(page.getByTestId("slash-palette")).toBeVisible();
    await page.getByTestId("toolbar-model").click().catch(() => {});
    await page.keyboard.press("Escape");
  });

  test("attach 点选文件插入 @路径", async () => {
    await seedAgentV7();
    const { page } = ctx;
    await page.getByTestId("toolbar-attach").click();
    const menu = page.getByTestId("toolbar-menu");
    await expect(menu).toBeVisible();
    await menu.locator("[data-testid='toolbar-menu-item']").filter({ hasText: /sample\.md/ }).first().click();
    await expect(page.locator(".composer textarea")).toHaveValue(/@.*sample\.md/);
  });

  test("view-chip × 切到原始输出", async () => {
    await seedAgentV7();
    const { page } = ctx;
    await page.getByTestId("view-chip").locator("[data-testid='chip-x']").click();
    await expect(page.locator(".reader-card .ansi")).toBeVisible();
    await expect(page.getByTestId("view-chip")).toHaveCount(0);
  });

  // NOTE(test-fix): V9 F4 (docs/plans/2026-09-16-v9-datastream-style.md) —
  // 工具条分段去边框（无边框文字+图标段），发送钮改为描边圆角方钮。几何契约
  // （单行/不相交/发送可见）保留，并按 PRD 增补形态断言：普通段无描边、
  // 发送钮 ≥30px 高、圆角 ≈10px。
  test("几何：控件行单行、按钮两两不相交、发送钮完整可见、段无边框", async () => {
    await seedAgentV7();
    const { page } = ctx;
    const rects = await page.evaluate(() => {
      const row = document.querySelector("[data-testid='composer-toolbar']");
      const els = [...row.querySelectorAll("button, [data-testid='composer-status']")].filter((e) => e.offsetParent !== null);
      const rs = els.map((e) => e.getBoundingClientRect());
      const rowR = row.getBoundingClientRect();
      return {
        singleRow: Math.max(...rs.map((r) => r.bottom)) - Math.min(...rs.map((r) => r.top)) <= 40,
        noOverlap: rs.every((a, i) => rs.every((b, j) => j <= i || a.right <= b.left + 0.5 || b.right <= a.left + 0.5)),
        sendInside: (() => {
          const send = document.querySelector("[data-testid='send-button']")?.getBoundingClientRect();
          return send ? send.right <= rowR.right + 1 && send.left >= rowR.left - 1 : false;
        })(),
        // V9 F4 form: regular toolbar segments are borderless (transparent)
        segmentBorderless: (() => {
          const seg = [...row.querySelectorAll(".tb-btn")].find((b) => !b.classList.contains("send-btn"));
          if (!seg) return false;
          const c = getComputedStyle(seg).borderTopColor;
          return c === "transparent" || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c);
        })(),
        // …while the send control is the outlined rounded square
        sendForm: (() => {
          const send = document.querySelector("[data-testid='send-button']");
          if (!send) return false;
          const r = send.getBoundingClientRect();
          const radius = parseFloat(getComputedStyle(send).borderTopLeftRadius);
          return r.height >= 30 && radius > 6;
        })(),
      };
    });
    expect(rects.singleRow, "controls on one row").toBeTruthy();
    expect(rects.noOverlap, "buttons must not overlap").toBeTruthy();
    expect(rects.sendInside, "send button inside toolbar").toBeTruthy();
    expect(rects.segmentBorderless, "toolbar segments must be borderless (V9 F4)").toBeTruthy();
    expect(rects.sendForm, "send button is the outlined rounded square (V9 F4)").toBeTruthy();
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
    // NOTE(test-fix): wait for the thread (and its clock) to actually mount
    // before grabbing the node. seedAgentV7 returns as soon as the agent is
    // registered in the store — the first pane.read may still be in flight,
    // so the grab used to store `undefined` and the identity check failed
    // regardless of streaming behavior. The contract under test ("clock DOM
    // node survives text streaming") is unchanged.
    await page.waitForSelector(".turn-time", { state: "attached", timeout: 15000 });
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
