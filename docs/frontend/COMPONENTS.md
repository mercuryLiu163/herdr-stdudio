# COMPONENTS.md — 组件使用映射

更新：2026-09-16 · 依据实际源码扫描（`src/components/`、`src/chat-parser.ts`、`src/store.ts`）。
约束：无第三方 UI 组件库/图标库（图标为 `icons.tsx` 自绘内联 SVG）；主题为
`global.css` 的 152 个 CSS 变量，`html[data-theme="dark|light"]` 双套。

## 业务场景 → 组件映射

| 业务场景 | 本地组件（真实路径） | 底层库 | 关键状态与约束 |
|---|---|---|---|
| 应用外壳/无边框窗口/窗口控制 | `src/components/Chrome.tsx` → `TitleBar`/`Rail` | Electron IPC（`herdr:win`） | 拖拽区 `-webkit-app-region`；主题切换 `theme-toggle` 在此 |
| 全局状态 | `src/store.ts`（zustand `useStore`） | zustand 4.5 | 字段：status/workspaces/tabs/panes/agents/outputs/active*/layoutMode/sidebarApp/sidebarRoot；V1 e2e 依赖这些字段名 |
| 工作区+标签合并树 | `src/components/Sidebar.tsx` → `Sidebar` | zustand | aria pin 态与子行可见性**解耦**（V3 契约）；激活 ws 自动展开；无独立标签列 |
| 主区调度（分屏/统一） | `src/components/MainPane.tsx` → `MainPane` | zustand | `layoutMode`：separate（阅读/对话）/ unified（Mosaic） |
| 对话数据流（沉浸式） | `MainPane.tsx` → `ChatView`/`ChatThread`/`ChatTurn`/`ChatBlock` | `src/chat-parser.ts`（纯函数） | parser **前缀确定性**是块级 memo 的前提；working 期仅末 turn 合并 thinking-live |
| 用户消息 | `MainPane.tsx` → `UserCard` | marked（转义先行） | 右对齐中性气泡；多行可折叠；结构续行并入 |
| markdown 正文/代码 | `MainPane.tsx` → `MarkdownBody`/`CodeBody`；`src/markdown.ts` | marked + highlight.js（core，13 语言） | 源码先 escapeHtml 再 parse；链接仅 http(s) 外开；hljs 双主题令牌 |
| thinking 实时行 | `MainPane.tsx` → `ThinkingLive` | 纯 CSS spinner | 仅末 turn + working；spinner 禁 JS 逐帧（transform keyframes） |
| turn 文件卡片 | `MainPane.tsx` → `TurnFilesCard` | — | 数据来自 parser 的 `tool.files` 聚合；V4 内嵌网格已移除 |
| 内联图片 | `MainPane.tsx` → `ChatImage` | IPC `fs:read`（data URL，8MB 上限） | 路径三级解析（cwd→其余 pane cwd→basename 弱信任，title 标注） |
| 统一马赛克 | `MainPane.tsx` → `Mosaic`/`MosaicCell` | `pane.layout`/`pane.resize`（amount=ratio 增量） | cell 按 paneId 独立订阅；ANSI 解析缓存 FIFO 64；布局事件驱动无盲轮询；拖拽 DOM 预览松手提交 |
| ANSI 原始输出 | `src/ansi.tsx` + `MainPane.tsx`（`.reader-card`/`.ansi`） | anser 2.2 | 按 paneId 缓存 HTML（FIFO 64）；`recent_unwrapped` 下划线命名 |
| 输入与状态栏 | `MainPane.tsx` → `Composer` | agent.prompt（失败精确回退 `pane.send_input`）/ `pane.send_input` | V9 离散描边按钮组：toolbar-attach/composer-attach/toolbar-model/view-chip/tools-button/composer-status/send-button；ghost 下拉面板关闭态 inert；斜杠面板 slash-palette |
| 右侧栏应用（文件/Git） | `src/components/RightSidebar.tsx` → `SidebarAppRail`/`RightSidebar` | IPC `fs:tree/fs:read/fs:open`、`git:status/git:diff` | repo-root 作用域（子目录显示"不是仓库"是已知语义）；marked 转义+导航防护 |
| 全局通知 | `src/components/Toasts.tsx` + main `Notification` | Electron | 渲染端仅 blocked/done 触发系统通知 |
| server 未运行空态 | `src/components/NoServer.tsx` | — | `HERDR_STUDIO_SOCKET` 指向无效路径时呈现 |

## 基础设施（非 UI 但被组件依赖）

| 模块 | 路径 | 约束 |
|---|---|---|
| herdr socket 客户端 | `electron/herdr-client.ts` | 每连接单请求；`events.subscribe` 常驻；枚举值下划线（`recent_unwrapped`） |
| 主进程面板流 | `electron/main.ts` `runPaneStream` | 600ms `pane.read` 轮询 + 变更转发；hubB 支持多 pane |
| agent 状态 watcher | `electron/main.ts` `startAgentStatusWatcher` | 3s `agent.list`；首见也发转换事件；通知限 blocked/done |
| 主题 | `src/theme.ts` + global.css | localStorage `herdr-studio-theme`；默认 dark |

## 缺失组件（如实标记，未擅自开发）

| 场景 | 状态 |
|---|---|
| 虚拟化长列表 | **缺失**——十万行日志场景无虚拟滚动，当前靠 `lines:400` 截断窗口 |
| 通用 Button/Input/Select 抽象 | **缺失**——描边按钮样式散落在 CSS 类中，未组件化 |
| 独立 Table 组件 | **缺失**——表格走 marked 默认渲染 + CSS 边框样式 |
| xterm.js 真终端 | **缺失**——「终端」档位为占位（V2 起规划） |
