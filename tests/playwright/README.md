# Playwright Test 套件(tests/playwright)

由 `npm run test:e2e`(= `npx playwright test`)执行。用例编号沿用
[`tests/testcases.md`](../testcases.md)(A~G)与
[`docs/plans/2026-09-09-v2-prd.md`](../../docs/plans/2026-09-09-v2-prd.md)(F1~F4)。

## 架构

```
npx playwright test
 ├─ globalSetup: esbuild 构建 dist-electron(main.js + preload.js)
 ├─ webServer:   vite dev renderer @ http://127.0.0.1:5173
 └─ specs(worker=1 串行):
     fixture.session  → herdr 隔离会话 studio-pw-*(tests/helpers/env.mjs 起/停)
     fixture.studio   → _electron.launch(ELECTRON_RENDERER_URL + HERDR_STUDIO_SOCKET)
```

Electron 全程通过 `_electron` 驱动,**不再依赖 CDP 端口**;`win` 就是标准 Playwright
Page,locator / expect / trace 全套可用。

## 文件

| 文件 | 覆盖用例 |
|---|---|
| `b-lifecycle.spec.mjs` | B1 B2 B3 |
| `c-render.spec.mjs` | C4 C5 C6(API 造数据 → DOM 断言) |
| `d-interaction.spec.mjs` | D4(composer 发送 + server 复核) |
| `e-resilience.spec.mjs` | E1(无 server 空态) |
| `v2-acceptance.spec.mjs` | F1~F4 `test.fixme` 骨架,实现功能后翻绿 |
| `support/fixtures.mjs` | 隔离会话 + Electron fixture |
| `support/global-setup.mjs` | 构建 electron main |

## 工作流(TDD)

1. PRD 写验收契约(data-testid + 行为),落在 `docs/plans/`
2. 在本目录落 spec:**未实现的功能用 `test.fixme`,标题即契约**
3. 实现时把 `fixme` 翻成 `test`,`npm run test:e2e` 跑绿
4. 新用例进 `testcases.md` 建号,spec 标题带同号前缀

## 安全红线

与 `tests/testcases.md` 一致:所有写入只进 `studio-pw-*`/`studio-e2e-*` 隔离会话;
禁止向默认会话发送任何输入;只清理自己创建的会话与进程。

## 与 playwright-cli 的关系

`playwright-cli` 用于**纯网页**的交互探索(起 vite 后对 127.0.0.1:5173 做
open/snapshot 探索 UI、辅助选 selector);Electron 实例的探索直接写 spec +
`npx playwright test --grep <TC>` 迭代,失败看 `tests/artifacts/pw-output` 下的
trace/截图。
