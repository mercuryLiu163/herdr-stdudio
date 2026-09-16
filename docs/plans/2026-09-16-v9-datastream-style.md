# Herdr Studio V9 — 主数据流与对话框样式复刻（mcode 深色参考）

日期：2026-09-16 · 基线：`v8`（main） · 参考：用户提供的两张 mcode 截图
（简洁态 / 富内容态，路径见评审脚本）。

## 本流程使用的 Skill（按 AGENTS.md 规则 B/C/D 标注）

- **design-dna**（已安装，project/zcode）：参考截图 → 结构化设计规范。Phase 2 实测
  取色已执行（`scripts/measure-colors.mjs`，确定性分层采样 16 万像素/图），测量
  JSON：`tests/artifacts/dna-measure-a.json`、`dna-measure-b.json`。下表令牌以实测
  值为准，替代目测猜测。
- **impeccable**（用户级 v4.0.4）：实现前读 `reference/craft-floor.md`（质量底线）
  与 `reference/new-work.md`（新面板流程）；本任务为既有对话面重排，以 craft-floor
  为准。
- **playwright-skill**：契约验证阶段（83 例 Playwright 套件 + 几何断言）。


## 设计令牌（dark 主题 chat 域新增/调整；light 主题同构映射白系）

| 令牌 | dark 值（design-dna 实测） | 用途 |
|---|---|---|
| --chat-bg | **#1a1e25**（实测覆盖 96.98%；富内容态 #1b1f26 同源） | 对话面背景 |
| --chat-text | **#f5f5f7** / #e8eaed | 对话正文 |
| --chat-dim | #9a9da5（实测 #8f9198~#aaadb3 区间） | 次要文字 |
| --chat-user-bubble | #262b33 | 用户单行气泡底（背景提亮档） |
| --chat-user-card | #21262e | 用户多行卡片底 |
| --chat-divider-pill | #262b33 | 回合丸底 |
| --chat-code-tint | rgba(29,164,112,.16) | 行内码/链接 chip 绿底（实测绿 #1da470） |
| --chat-code-text | #3fbf85 | 行内码/链接文字绿 |
| --chat-danger | #d86863（实测） | Bypass 红 / 中断描边 |

对话沉浸面（chat-immersive）背景改用 --chat-bg；其余应用骨架（侧栏/标题栏）不变。

## F1 回合分隔丸（替换现 turn-header 头部条）

- 形态：居中，一条 1px hairline 横贯，丸压在线上：
  `› HH:MM:SS · <时长>`（有时长）/ `› HH:MM:SS`（无时长）
- 丸：底 --chat-divider-pill、radius 999、padding 3px 12px、13px；`›` 为折叠
  切换钮（点击折叠/展开该 turn 正文，折叠态仅留丸）
- **移除**：头像、agent 名、步数/文件数 chips（本参考无这些元素）
- `.turn-time` 类名保留在时间 span 上（V7 时钟隔离断言依赖）
- 保留：仅末 turn thinking-live 转圈逻辑不变

## F2 用户消息两态

- 单行短消息（≤1 行且无 markdown 结构）：右对齐小气泡
  （--chat-user-bubble，radius 12，padding 8px 12px，max-width 72%）
- 多行/结构化：右对齐圆角卡片（--chat-user-card，radius 14，max-width 80%）+
  顶部紧凑标题条：📄 图标 + 首行截断（绿色文字，参考图样式）+ chevron 折叠正文
- 正文走既有 markdown 渲染（列表/链接）

## F3 助手散文（保持并微调）

- 直接铺在对话面上（无卡片），正文 --chat-text 14.5px/1.75
- **行内码/URL chip 绿化**：`.chat-md :not(pre) > code` 与 `.chat-md a` 用
  --chat-code-tint 底 + --chat-code-text 文字；URL 保留下划线
- 粗体小节标题（**操作结果** 形态）自然生效（marked strong）
- turn-files-card / thinking 行保留，但配色随新令牌（更融入近黑面）

## F4 Composer 对话框

- 卡片：--chat-bg 上浮一层 `#161619`（light：白）、radius 16、border 发丝、
  padding 14 16；占位行在上、工具条行在下（结构不变）
- **工具条段全部去边框**：各按钮（⊕/📎/模型∨/effort∨/mode∨/状态环/徽标）改为
  无边框文字+图标段（hover 淡底圆角），段间 gap 10px——参考图无描边分段
- 发送钮：右端**描边圆角方钮**（radius 10、36×32、➤ 图标；working=红描边 ■ 中断），
  flex-shrink:0 恒可见
- Esc ghost chip、几何断言（不相交/发送可见）保留

## 契约迁移（实现者执行，均留 NOTE(test-fix)）

- v5 F1（turn 头部头像/名称/步数/文件数断言）→ 迁移为新分隔丸断言：
  丸存在、含 HH:MM:SS 格式时间、含时长（若有）、折叠交互可用
- v6 F2（turn-header 无边框无盒底）→ 语义更新：丸允许有底色（--chat-divider-pill），
  但仍断言其水平居中于对话面
- v7 F5（工具条分段描边形态断言如有）→ 改为无边框断言；send-button 形态断言更新
- v7 F7 时钟 DOM 身份断言：.turn-time 保留，不需改
- 其余 V2–V8 契约（msg-*、chat-immersive、view-chip、几何断言）不回退

## 验收

- 上述契约全绿 + 全套件（83 例）+ run-all + typecheck
- judge 终审：Read 两张参考图与 light/dark 实拍，判「是否同一设计语言同类实现」，
  重点：近黑对话面、居中丸、纯散文助手、绿色行内码、composer 无边框段与描边发送钮
