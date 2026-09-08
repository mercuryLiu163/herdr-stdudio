# Herdr Studio — 设计文档

日期：2026-09-08
状态：已确认（产品形态：驾驶舱+终端混合；技术栈：Electron）

## 1. 背景与目标

herdr 的 TUI 在终端里显示编码 agent 的工作状态，但视觉表现受限。Herdr Studio
是基于 herdr server 的桌面客户端，让用户在精致的图形界面里**监督、阅读、驱动**
自己的编码 agent。

参考风格：Claude Code 桌面版 —— 暖炭黑底色、赤陶橙（terracotta）强调色、
奶油白正文、圆润卡片、大量留白、输出区用等宽字体、界面用无衬线字体。

### 成功标准
- 双击图标启动，自动发现并连接本机 herdr server；server 未运行时给出可操作提示。
- 不打开 herdr TUI 也能看到：有哪些 workspace / tab / pane、每个 agent 的
  idle / working / blocked / done 状态、正在输出什么。
- 可以直接向 agent 发 prompt、发送 Esc / Ctrl+C 中断，输入框支持多行与粘贴。
- agent 变为 blocked / done 时发 Windows 系统通知。
- 界面实时刷新（事件推送，非轮询），延迟体感 < 1s。

### 非目标（V1）
- 不做完整的终端仿真（V2 用 xterm.js 内嵌，架构已预留）。
- 不做布局编辑（split/move/resize 等 API 保留，UI 暂不暴露）。
- 不做远程（SSH）会话管理。

## 2. 传输层（已验证）

herdr server 暴露 JSON-RPC over local socket，按行分帧：

- 指针文件 `%APPDATA%\herdr\herdr.sock`（POSIX 为真实 unix socket）。
- Windows 上内容为 `<server-pid>:<nonce>`，实际管道名为该文件完整路径：
  `\\.\pipe\C:\Users\<u>\AppData\Roaming\herdr\herdr.sock`（已实测连通）。
- POSIX 上直接 `net.connect(path)`。
- 请求 `{"id","method","params"}`，响应 `{"id","result"}` 或 `{"id","error"}`，
  server 主动推送 `{"event":...}` 信封。协议版本 protocol 19（herdr 0.8.0-preview）。

客户端能力：`session.snapshot` 一次性取全量状态；`events.subscribe` 订阅增量
事件；其余方法见 `herdr api schema`（约 90 个）。V1 使用的方法：
snapshot、subscribe、workspace.list、tab.list、pane.list、pane.read、
pane.send_text、pane.send_keys、agent.list、agent.get、agent.prompt、
agent.send_keys、notification.show。

## 3. 架构

```
E:\MyCode\herdr studio\
├─ package.json            electron + vite + react + typescript
├─ electron\
│  ├─ main.ts              窗口创建（无边框+自绘标题栏）、生命周期、系统通知
│  ├─ herdr-client.ts      管道发现/连接/重连、JSON-RPC 多路复用、事件扇出
│  └─ preload.ts           contextBridge: invoke(method,params) / onEvent(cb)
├─ src\
│  ├─ main.tsx / App.tsx   React 入口
│  ├─ store.ts             zustand：snapshot 合并 + 事件归约
│  ├─ api.ts               类型化方法封装（前端只调语义函数）
│  ├─ ansi.tsx             ANSI→React 片段（anser），保留颜色/加粗
│  ├─ components\          Sidebar / WorkspaceList / TabList / OutputReader /
│  │                       Composer / StatusBar / TitleBar / NotificationHost
│  └─ styles\              设计令牌 + 全局样式（纯 CSS，无 UI 框架）
```

数据流：主进程维持唯一 socket 连接 → 渲染端加载时调 `session.snapshot` 建
立本地状态树 → 订阅 `events.subscribe`（全部事件类型）→ 主进程把事件原样
扇给渲染端归约合并 → 输出区收到 `pane_output_changed` 后按 300ms 节流调
`pane.read`(recent-unwrapped, ansi) 刷新当前可见 pane。

断线处理：socket error/close 后指数退避重连（0.5s→8s 封顶）；重连成功后
重新 snapshot 全量对齐，期间 UI 顶栏显示「重连中」。

## 4. UI 设计

布局三栏，无边框窗口 + 自绘标题栏：

- **左栏（侧边导航，56px 图标轨 + 224px 面板）**：工作区列表，每项显示名称、
  打开的 tab 数、活跃 agent 数徽标。
- **中栏（标签列表，240px）**：当前工作区的 tab；每行 tab 名 + agent 状态点
  + agent 类型小字（codex / claude / gemini…）。状态色见下。
- **主区（阅读视图）**：顶部 tab 标题 + pane 芯片（shell/agent 可切换）；正文
  为居中卡片（max-width 880px）内渲染 ANSI 富文本输出，自动滚动到底部、
  上滑即停；底部输入框：圆角大输入区（Enter 发送 / Shift+Enter 换行），
  右侧发送按钮，左侧快捷键芯片（Esc 中断、Ctrl+C）。

设计令牌（Claude 风）：

| 令牌 | 值 | 用途 |
|---|---|---|
| bg | #262624 | 窗口底色（暖炭黑）|
| surface | #1F1E1D / #30302E | 侧栏 / 卡片 |
| border | #3A3937 (40%) | 分隔线 |
| text | #F0EEE6 | 正文（奶油白）|
| text-dim | #B8B5AD | 次要文字 |
| accent | #D97757 | 主按钮 / 活动态 / 焦点环 |
| status.working | #D97757（呼吸动画）| working |
| status.idle | #7FB069 | idle |
| status.blocked | #E8A33D | blocked（需注意）|
| status.done | #6B9AC4 | done |
| 字体 | UI: "Segoe UI"/system-ui；输出: "Cascadia Mono"/Consolas；标题: Charter/Georgia 衬线 | |

终端视图位：主区顶部一个「阅读 / 终端」分段控件，「终端」页 V1 显示
占位说明，store 与 api 层已为 xterm.js 预留 `paneId → 字节流` 接口。

## 5. 错误处理

- server 未运行：首屏空状态页 + 「启动 herdr」按钮（spawn `herdr --session`）。
- 方法级错误：toast 显示 code+message，不打断主流程。
- `agent_prompt_stalled` 等语义错误在输入框上方内联提示。

## 6. 验证方案

1. `npm run dev` 启动真实应用，连接真实 herdr server。
2. 主进程暴露 `--screenshot=<path>` 调试参数：启动完成后
   `webContents.capturePage()` 输出 PNG，供视觉走查。
3. 用 judge 对截图做验收（布局/风格/可读性），迭代修复。
4. 手工脚本验证：向测试 pane 发 prompt，观察状态流转与通知。

## 7. 打包

electron-builder，target: nsis（Windows x64），应用名 `Herdr Studio`，
图标后续补充。dev 模式 `npm run dev`，构建 `npm run dist`。
