// D. 交互与实时性(testcases.md D4/D5 子集;所有发送只进隔离会话)
import { test, expect } from "./support/fixtures.mjs";

test("D4 shell 命令发送:composer 输入 echo 后 reader 出现标记", async ({ studio }) => {
  const { win, session } = studio;
  const marker = `STUDIO_E2E_D4_${Date.now().toString(36)}`;

  const ta = win.locator(".composer textarea");
  await expect(ta).toBeEnabled({ timeout: 15_000 });
  await ta.fill(`echo ${marker}`);
  await ta.press("Enter");

  // 输出轮询链路(主进程 600ms 轮询 → 渲染层)回显标记
  await expect(win.getByTestId("reader-card")).toContainText(marker, { timeout: 10_000 });

  // server 侧复核
  const snap = await session.api.snapshot(session.socket);
  expect(JSON.stringify(snap)).toContain(marker);
});
