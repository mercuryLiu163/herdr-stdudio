// B. 应用生命周期与连接(testcases.md B1–B3)
import { test, expect } from "./support/fixtures.mjs";

test("B1 应用启动:进程存活、渲染端加载、无白屏", async ({ studio }) => {
  const { win } = studio;
  await expect(win.locator("#root > *").first()).toBeVisible();
});

test("B2 连接状态:状态胶囊变为「已连接」", async ({ studio }) => {
  const { win } = studio;
  await expect(win.getByText("已连接", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("B3 socket 信息:preload socketInfo 指向隔离会话", async ({ studio }) => {
  const { win, session } = studio;
  const info = await win.evaluate(() => window.herdr.socketInfo());
  expect(JSON.stringify(info)).toContain(session.name);
});
