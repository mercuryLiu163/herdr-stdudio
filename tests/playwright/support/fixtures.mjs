// Playwright fixtures:一次性 herdr 隔离会话(worker 级)+ Electron 应用实例(test 级)。
// 安全约定与 tests/testcases.md 一致:所有写入只发生在 studio-pw-* 隔离会话,
// 绝不触碰默认会话;会话清理复用 tests/helpers/env.mjs 的 startSession/stopSession。
import { _electron, test as base } from "@playwright/test";
import { PROJECT, startSession, stopSession } from "../../helpers/env.mjs";
import { api } from "../../helpers/herdr-api.mjs";

export const test = base.extend({
  /** 一次性 herdr 隔离会话:{ name, socket, api }。worker 内所有用例共用。 */
  session: [
    async ({}, use) => {
      const name = `studio-pw-${Date.now().toString(36)}`;
      const s = await startSession(name); // 等 ping 通,失败会抛错
      await use({ ...s, api });
      await stopSession(name); // stop + delete,只清理自己创建的会话
    },
    { scope: "worker" },
  ],

  /** 每个用例一个全新 Electron 实例:{ app, win, session }。指向 vite dev server。 */
  studio: [
    async ({ session }, use, testInfo) => {
      const app = await _electron.launch({
        args: ["."],
        cwd: PROJECT,
        env: {
          ...process.env,
          HERDR_STUDIO_SOCKET: session.socket,
          ELECTRON_RENDERER_URL: "http://127.0.0.1:5173",
          HERDR_STUDIO_TEST_LOG: testInfo.outputPath("notifications.jsonl"),
        },
      });
      const win = await app.firstWindow();
      await use({ app, win, session });
      await app.close();
    },
    { scope: "test" },
  ],
});

export const expect = base.expect;
