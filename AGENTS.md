# AGENTS.md — Herdr Studio

桌面端(Electron + React/Vite)cockpit,连接本机 herdr server(named pipe)。

## 常用命令

- `npm run dev` — vite + esbuild watch + electron 三开
- `npm run build` / `npm run typecheck`
- `npm run test:e2e` — Playwright Test(tests/playwright/,自动 build:main + 起 vite)
- `npm run test:e2e:report` — 打开测试报告
- `node tests/run-all.mjs` — 旧自制 runner(协议层 + CDP E2E,逐步迁移中)

## E2E 工作流(TDD)

1. PRD 放 `docs/plans/`,验收契约写明 data-testid 与行为
2. 测试先行:在 `tests/playwright/` 落 spec;未实现的功能用 `test.fixme`,标题即契约
3. 实现功能 → `fixme` 翻 `test` → `npm run test:e2e` 全绿为完成标准
4. 用例编号:`tests/testcases.md`(A~G)、V2 PRD(F1~F4);spec 标题带同号前缀

fixture 用法见 `tests/playwright/README.md`;新 spec 一律从
`./support/fixtures.mjs` 导入 `test/expect`,拿 `session`(隔离 herdr 会话)与
`studio`(`{ app, win }`)。

## 安全红线(必须遵守)

见 `tests/testcases.md`「安全红线」:所有写入只进 `studio-pw-*`/`studio-e2e-*`
一次性会话;禁止向默认会话(`%APPDATA%\herdr\herdr.sock`)的任何 pane/agent 发送
prompt、命令、按键;禁止 stop/kill/delete 默认会话;测试结束清理自己创建的资源。
