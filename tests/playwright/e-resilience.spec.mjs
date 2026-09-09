// E. 异常与韧性(testcases.md E1)
import { _electron, test, expect } from "@playwright/test";
import { PROJECT } from "../helpers/env.mjs";

test("E1 server 未运行空态:空态页渲染,不点击启动按钮", async () => {
  const app = await _electron.launch({
    args: ["."],
    cwd: PROJECT,
    env: {
      ...process.env,
      HERDR_STUDIO_SOCKET: "\\\\.\\nonexistent\\studio-pw-no-server.sock",
      ELECTRON_RENDERER_URL: "http://127.0.0.1:5173",
    },
  });
  const win = await app.firstWindow();
  await expect(win.getByRole("heading", { name: "herdr server 未在运行" })).toBeVisible({
    timeout: 15_000,
  });
  await app.close();
});
