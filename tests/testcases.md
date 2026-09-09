# Herdr Studio 完整测试用例

版本：v0.1.0 · herdr 0.8.0-preview（protocol 19）
日期：2026-09-09
执行方式：`node tests/run-all.mjs`（协议层 + CDP 驱动的 E2E，全部自动化）

## 测试环境约定

| 术语 | 含义 |
|---|---|
| **隔离会话** | 通过 `herdr --session studio-e2e-<ts>` 创建的一次性命名会话（独立 server + 独立 socket），测试的**所有写入操作**都发生在这里，结束后 stop + delete |
| **默认会话** | 用户真实使用的 herdr 会话（`%APPDATA%\herdr\herdr.sock`），测试只做**只读冒烟**，绝不向其发送任何命令/prompt/按键 |
| **被测应用实例** | Electron 加载已构建产物启动，`HERDR_STUDIO_SOCKET` 指向目标会话 socket，`--remote-debugging-port` 开 CDP 供断言 |
| **fake agent** | 用 `pane.report_agent {pane_id, source, agent, state}` 在隔离会话的 shell pane 上注册的假 agent，可任意切换 idle/working/blocked 状态 |

**安全红线**（适用于执行者与自动化）：
1. 禁止向默认会话的任何 pane/agent 发送 prompt、命令、按键。
2. 禁止 stop/kill/delete 默认会话或用户 TUI 进程。
3. 只清理自己创建的资源：`studio-e2e-*` 会话、测试 Electron 进程、`tests/artifacts/`。

---

## A. 协议层集成测试（`tests/api.test.mjs`，无 Electron，直连隔离会话）

| ID | 用例 | 步骤 | 预期 |
|---|---|---|---|
| A1 | ping 握手 | 连接 socket，发 `ping {}` | 返回 `pong`，含 version + protocol=19 + capabilities |
| A2 | 快照结构 | `session.snapshot {}` | 顶层含 workspaces/tabs/panes/agents 数组与 focused_*_id 字段 |
| A3 | 单连接单请求 | 同一连接连续发两个 ping | 第一个得到应答，第二个请求时连接已被服务端关闭（write EPIPE / close） |
| A4 | 工作区创建 | `workspace.create {}` | 返回 workspace/tab/root_pane 三个对象；snapshot 中可查到，pane_count=1 |
| A5 | 读取源与格式 | 对 root pane 分别 `pane.read`：visible/recent/recent_unwrapped/detection × text/ansi | 均成功返回 PaneReadResult；ansi 格式 text 含转义序列；strip_ansi=true 时不含 |
| A6 | shell 命令执行 | `pane.send_input {text:"echo A6_<ts>", keys:["enter"]}` → 轮询 read | 输出出现 `A6_<ts>` |
| A7 | 按键发送 | `pane.send_keys {keys:["esc"]}`、`["ctrl+c"]` | 无错误返回 |
| A8 | fake agent 注册与状态 | `pane.report_agent {state: working}` → 改 `idle` → 改 `blocked` | snapshot.agents 出现该 pane 的记录：working → **idle/done**（herdr 语义：idle 且未被任何 UI 看过 ⇒ 派生为 done）→ blocked；tab/workspace 的 agent_status 同步 |
| A9 | fake agent 注销 | `pane.clear_agent_authority {pane_id}` | snapshot.agents 中该 pane 记录消失 |
| A10 | output_matched 推送 | 订阅 `pane.output_matched`（regex "."）→ echo → 再次 echo | 订阅后 6s 内推送一次到达；**此后不再推送（一次性语义）**。注意：首条推送的载荷可能是订阅前缓冲内容或新 echo（服务端怪癖，不作为断言）。app 因此用 600ms `pane.read` 轮询实现输出流 |
| A11 | 并发 RPC | 同时发起 8 个 `ping`（8 条连接） | 全部成功，无串扰 |
| A12 | 全局状态事件流 | `events.subscribe [workspace.created]` → 创建新工作区 | 收到 `workspace_created` 推送 |

## B. 应用生命周期与连接（E2E，隔离会话）

| ID | 用例 | 步骤 | 预期 |
|---|---|---|---|
| B1 | 应用启动 | Electron 以 `HERDR_STUDIO_SOCKET=隔离会话` 启动 | 进程存活、渲染端加载、无白屏（root 有子元素） |
| B2 | 连接状态 | 等 store.status | 变为 `connected`，标题栏显示「已连接」胶囊 |
| B3 | socket 信息 | 经 preload `socketInfo()` | pointer 路径 = 隔离会话 socket 路径 |

## C. 状态渲染（E2E，隔离会话）

| ID | 用例 | 步骤 | 预期 |
|---|---|---|---|
| C1 | 快照全量渲染 | 准备 2 工作区 × 2 标签 × 多 pane 的隔离会话，读 store | workspaces/tabs/panes 数量与 server snapshot 完全一致 |
| C2 | 侧栏工作区条目 | 查 DOM `.ws-item` | 数量=工作区数，名称/副文本（标签数/agent 数）正确渲染 |
| C3 | 标签列 | 查 DOM `.tab-item` | 数量=当前工作区标签数；active tab 高亮 |
| C4 | 主区标题 | 读 DOM `.main-header h1` | 等于 active tab 的 label；shell 时副标题为「普通终端」 |
| C5 | pane 芯片 | 查 DOM `.pane-chip` | 数量=该标签 pane 数；active 芯片高亮；shell 芯片有文字 |
| C6 | 输出卡片 | 查 DOM `.reader-card .ansi` | 存在且文本非空（root pane 的欢迎输出） |

## D. 交互与实时性（E2E，隔离会话）

| ID | 用例 | 步骤 | 预期 |
|---|---|---|---|
| D1 | 工作区切换 | 点击第二个工作区 `.ws-item` | store.activeWorkspaceId 变化，标签列重渲染 |
| D2 | 标签切换 | 点击目标 `.tab-item` | 主区 h1 更新为新标签名，activePaneId 落到该标签的 pane |
| D3 | pane 切换 | 点击另一个 `.pane-chip` | activePaneId 变化，reader 显示该 pane 内容 |
| D4 | shell 命令发送 | composer 输入 `echo STUDIO_E2E_D4_<ts>` + Enter | 3s 内 reader 文本包含该标记；server 侧 `pane.read` 复核一致 |
| D5 | 输入框行为 | Shift+Enter 输入两行后按 Enter | Shift+Enter 不发送、保留文本；Enter 发送后输入框清空 |
| D6 | Esc 中断 | 点击「Esc 中断」按钮 | toast「已发送 esc」出现，无 error toast |
| D7 | Ctrl+C 按键送达 | 前台运行读取 raw stdin 的 node 脚本 → 点击「Ctrl+C」 | 前台程序收到 `0x03`（输出 `E2EKEY:"\u0003"`）。**已知平台限制**：herdr/ConPTY 注入的 0x03 不会中断 ping 等原生控制台程序（实测），对读取 raw 输入的 agent TUI 有效 —— 这正是该按钮的用途 |
| D8 | agent 状态显示 | report_agent working → 改 blocked | pane 芯片/状态点变为对应状态（store + DOM），主区副标题状态文案变化 |
| D9 | blocked 系统通知 | report_agent state=blocked | `HERDR_STUDIO_TEST_LOG` JSONL 新增一条记录（标题含 agent 显示名与「需要确认」） |
| D10 | agent prompt 路径 | 对 fake agent 在 composer 输入 + Enter | app 以 `agent.prompt(target=pane_id)` 发出请求 —— herdr 对 `report_agent` 假 agent 返回 `agent <pane_id> is not an active named agent`，该 inline error 即为调用链路正确的证据。**真 agent 的端到端 delivery 为人工测试项**（需要消耗 token） |
| D11 | 实时输出推送 | 不经 UI，直接 API 向 active pane `send_input echo STUDIO_E2E_D11_<ts>` | 2s 内 reader 文本出现标记（主进程 600ms 轮询 + 变更转发链路） |
| D12 | 切换跟随流 | 两个 pane 分别 echo 不同标记，切换芯片 | reader 内容跟随 activePaneId，旧 pane 停止更新 |
| D13 | 后台 agent 状态通知 | 在非活跃 pane 上 report_agent working→blocked，等待 ≤5s | 通知日志新增记录（主进程 3s agent.list 轮询合成状态迁移事件） |

## E. 异常与韧性（E2E）

| ID | 用例 | 步骤 | 预期 |
|---|---|---|---|
| E1 | server 未运行空态 | `HERDR_STUDIO_SOCKET` 指向不存在的路径启动 | 空态页「herdr server 未在运行」+「启动 herdr」按钮渲染；status=no-server（不点击按钮，避免 spawn） |
| E2 | 断线重连 | kill 隔离会话进程 → 等 status → 重新 spawn 同名会话 | 先显示「重连中」（status=reconnecting），恢复后自动回到 connected 并重新加载数据 |
| E3 | 关闭窗口 | CDP 调用「关闭」按钮 | Electron 进程在 5s 内退出 |

## F. 真实默认会话只读冒烟（E2E，默认会话，**只读**）

| ID | 用例 | 步骤 | 预期 |
|---|---|---|---|
| F1 | 连接真实会话 | Electron 以默认 socket 启动（不加任何输入） | status=connected；工作区数量 ≥1；渲染无异常。**禁止任何发送操作** |

## G. 视觉验收（已完成）

| ID | 用例 | 状态 |
|---|---|---|
| G1 | judge 视觉走查（Claude 风格还原/布局/可读性） | ✅ 已通过（screenshots/studio-1788885355184.png） |

---

## 通过标准

- A/D 层全用例通过；B/C/E/F 至少 95% 通过（E2 有 10s 容忍窗口仍失败才判 fail）。
- 每个失败必须附：复现步骤、实际 vs 预期、相关日志/截图（存 `tests/artifacts/`）。
- 结束后 `herdr session list` 中无 `studio-e2e-*` 残留；无孤儿 Electron 进程。

---

## H. Playwright Test 执行层(2026-09-10 新增)

`tests/playwright/` 下的 Playwright Test 套件复用本文档的用例编号作为测试标题前缀,
隔离会话与安全红线约定完全一致(前缀 `studio-pw-*`,经 `tests/helpers/env.mjs` 起停):

- 运行:`npm run test:e2e`(= `npx playwright test`);报告:`npm run test:e2e:report`
- B1–B3 → `b-lifecycle.spec.mjs`;C4–C6 → `c-render.spec.mjs`
- D4 → `d-interaction.spec.mjs`;E1 → `e-resilience.spec.mjs`
- V2 PRD 契约 F1–F4 → `v2-acceptance.spec.mjs`(`test.fixme` 骨架,实现后翻绿)
- 其余用例(A 协议层、D6–D13、E2–E3、F1 冒烟)仍由 `node tests/run-all.mjs` 执行
