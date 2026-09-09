// C. 状态渲染(testcases.md C4/C5/C6 子集,经 API 造数据后验证 DOM 渲染)
import { test, expect } from "./support/fixtures.mjs";

test("C4/C5 新工作区渲染:侧栏条目、主区标题、pane 芯片", async ({ studio }) => {
  const { win, session } = studio;
  const created = await session.api.workspaceCreate(session.socket);
  const wsLabel = created.workspace.label;
  const tabLabel = created.tab.label;

  // 应用经 workspace.created 事件/轮询拿到新工作区
  await expect(win.locator(".ws-item", { hasText: wsLabel })).toBeVisible({ timeout: 15_000 });
  await expect(win.locator(".main-header h1")).toHaveText(tabLabel);
  await expect(win.locator(".pane-chip").first()).toBeVisible();
});

test("C6 输出卡片:root pane 欢迎输出非空", async ({ studio }) => {
  const { win } = studio;
  const reader = win.getByTestId("reader-card");
  await expect(reader).toBeVisible({ timeout: 15_000 });
  await expect(reader).not.toHaveText("");
});
