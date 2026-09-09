import { defineConfig } from "@playwright/test";

// Playwright Test 套件(tests/playwright)。
// - globalSetup 先用 esbuild 构建 electron main(测试加载的是构建产物)
// - webServer 起 vite renderer(Electron 以 ELECTRON_RENDERER_URL 指向它)
// - 用例编号沿用 tests/testcases.md(A~G)与 docs/plans V2 PRD(F1~F4)
export default defineConfig({
  testDir: "tests/playwright",
  workers: 1, // herdr 隔离会话与 Electron 实例有状态,必须串行
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "tests/artifacts/pw-output",
  globalSetup: "tests/playwright/support/global-setup.mjs",
  webServer: {
    command: "npm run dev:renderer",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
