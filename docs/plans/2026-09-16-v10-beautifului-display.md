# Herdr Studio V10 — BeautifulUI 显示组件移植（thinking / streaming text / loading）

日期：2026-09-16 · 基线：`v9`（main 1e0a974） · 来源：https://www.beautifului.dev/（MIT）
源码已从官方页面 flight payload 提取：`%TEMP%\bui-src-12.tsx`（Loading State）、
`bui-src-13.tsx`（Thinking）、`bui-src-14.tsx`（Streaming Text）。三者均为
**纯 React 零外部依赖**（仅 react hooks；样式为 Tailwind 类，需移植到本项目
CSS 令牌体系）。

## 移植原则

1. 保留原组件的**行为机制**（时序编排、状态机、回调契约），样式翻译为本项目
   `--chat-*` 令牌；不引入 Tailwind / Framer / glimm / liveline（PROMPT BAR 的
   glimm 着色器与 Surfer 视频变体不做）。
2. 新目录 `src/components/bui/`：`ThinkingState.tsx`、`StreamingText.tsx`、
   `LoadingState.tsx`（文件头注明 "adapted from beautifului.dev (MIT)"）。
3. 真实数据映射（不做假内容）：
   - ThinkingState `rows` = 本回合真实工具行（`⏺ Edit(src/x)` 等已解析 tool 块摘要）
   - `active` = `思考中 Ns`（Elapsed）；`done` = `Thought for <时长>`（meta 到达后）
   - `onSettled` = 回合时长 meta 到达时触发（→ 定格折叠，正文继续）
   - StreamingText 的 `sources/followUps` 为可选；herdr 无引用数据则不渲染

## F1 StreamingText 移植 + 接入（助手正文流式）

- 原组件模型：固定 token 数组 + 逐词 `count` 递增（WORD_MS ~40ms）+ 末尾光标
  span + `onDone`；`loop=false` 用于真实线程（源码注释明确）
- **适配轮询数据**：token 派生自当前 `outputs.text`（按词/字符切分）；reveal
  count 独立 interval 推进、上限 = token 总数；轮询带来新 token 时数组延长、
  reveal 继续追赶 → **流式节奏与 600ms 轮询解耦**（V9 卡顿问题的终极解法）
- 光标 span：流式期间显示（CSS 闪烁），追平后消失
- 接入点：分屏对话视图的 assistant 正文（ChatBlock assistant 分支）替换直铺；
  working 结束（回合有时长 meta）且 reveal 追平 → onDone（无操作即可）
- 行为保留：raw 视图不变；turn 结束后文本必须**完整**（reveal 全量）

## F2 ThinkingState 移植 + 接入（thinking 转圈 → 可展开 trace）

- 原组件机制：`useSequence(STAGES)` 编排（working→逐行显现→settle）、
  auto-expanded、manualExpanded 覆盖、`onSettled`、四变体
- 接入：thinking 块出现时（末 turn、working）渲染为 trace：
  `active="思考中 Ns"`、rows=真实工具行（最近 3-5 条）、settle=时长 meta 到达 →
  `done="Thought for <时长>"` 收起；**thinking-live 单行转圈语义由本组件承担**
  （替换 V9 的 ThinkingLive 视觉，`thinking-live`/`thinking-spinner` testid 保留
  在组件根/spinner 上以兼容契约）
- 已终结回合的 thinking 保持 V4 定格折叠行（与 V7 契约一致）
- 四变体中仅用 Steps/Reasoning 两个（herdr 数据不含 Search/Coding 语义）

## F3 LoadingState 移植 + 接入（等待输出态）

- 像素网格 LoaderGrid + shimmer 文字 + 已耗时（useElapsed 1s tick 独立组件）
- 接入：分屏对话视图、agent working 且当前无 assistant 正文时，正文区顶部渲染
  `[data-testid="bui-loading"]`（label="等待输出"）；首个 assistant token 到达即
- 移除 Surfer 视频变体（外部 blob 违反零外部请求）；其余 grid 变体保留 1-2 个

## 任务 B（追加，2026-09-18）：过程行规范化（用户 UX 修复）

用户截图实证：Claude Code 的状态动词行 `· Discombobulating... between manual
mode, auto-accept edit mode, and plan mode` 以未排版多行块漏进对话流。契约：

1. **解析**（`src/chat-parser.ts`）：以 `·`（U+00B7 中点）开头的行不再判为
   tool / assistant 正文（工具 marker 集合保持 `⏺ ● • ◆`，`·` 明确排除），
   连同其后续无 marker 续行一起归为 `thinking`（过程）块；块上新增
   `detail` 字段保存已捕获的原始过程文本。任何结构行（user/tool/meta/
   thinking/fence/真实 call）关闭捕获。
2. **显示**：thinking/过程块在 working 期一律折叠为单行 —— ThinkingState
   live 行文案 = `思考中` + CSS 动画点点点（opacity 波浪，transform/opacity
   之外不引入布局动画）+ 已耗时；已捕获过程文本**不进 DOM**（auto-expand
   被 `trace` 压制，展开时才挂载），点击行可展开查看原始过程文本。
3. 回合终结后定格为 `思考 Ns` 折叠行（现契约）；定格行受控展开，原始过程
   文本同样只在展开后挂载可见。
4. 测试：`· Discombobulating...` 种子 → working 期单行 `思考中`（原始文本
   不在可见正文/DOM），点击行后可见；定格后展开同样可见；既有契约不回退。

## 验收（v7 spec 追加/调整，实现者可细化并 NOTE）

- F6 调整：thinking-live → ThinkingState trace（spinner/合并语义由组件承担，
  testid 兼容或迁移说明）；回合终结后定格行为不变
- 新增：working 无正文 → `bui-loading` 可见；首个 assistant token 后消失
- 新增：流式追赶 —— 轮询一次注入多 token 后，reveal 在 ≤2.5s 内追平全量文本
- 既有全绿：v2–v6 契约、V8、run-all、typecheck
- 几何/无盒规则不变（组件底透明，融入 --chat-bg）

## 约束

- 新增依赖：**无**（三个组件纯 React；Tailwind 类全部翻译为 CSS）
- 改动集中：`src/components/bui/`（新）、`src/components/MainPane.tsx`（接入点）、
  `src/styles/global.css`（组件样式令牌）
- V8 spec 零修改；安全基线不回退
