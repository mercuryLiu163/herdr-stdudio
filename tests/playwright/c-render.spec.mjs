// C. 状态渲染(testcases.md C4/C5/C6 子集,经 API 造数据后验证 DOM 渲染)
import { test, expect } from "./support/fixtures.mjs";

test("C4/C5 新工作区渲染:侧栏条目、主区标题、pane 芯片", async ({ studio }) => {
  const { win, session } = studio;
  const created = await session.api.workspaceCreate(session.socket);

  // 侧栏条目 1 → 2(默认工作区与新工作区同名,故按数量断言)
  await expect(win.locator(".ws-item")).toHaveCount(2, { timeout: 15_000 });

  // 新工作区不会自动激活:点击切换(D1 语义)后主区渲染其标签与 pane 芯片
  await win.locator(".ws-item").nth(1).click();
  await expect(win.locator(".main-header h1")).toHaveText(created.tab.label);
  await expect(win.locator(".pane-chip").first()).toBeVisible();
});

test("C6 输出卡片:root pane 欢迎输出非空", async ({ studio }) => {
  const { win } = studio;
  const reader = win.getByTestId("reader-card");
  await expect(reader).toBeVisible({ timeout: 15_000 });
  await expect(reader).not.toHaveText("");
});
