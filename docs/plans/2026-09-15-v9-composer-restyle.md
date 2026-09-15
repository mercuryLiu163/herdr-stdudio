# Herdr Studio V9 — Composer 复刻规格（对标参考截图）

日期：2026-09-15 · 基线：`v7`（main） · 参考图：用户提供的浅色 composer 截图
（占位行 + 控件行：⊕ / 📎 / ▦Tools / 高亮 chip× / …… / 🎤 / Run Ctrl←）

## 设计语言（从参考图逐像素提炼）

- Composer 卡：白底（light）/ surface（dark），1px 发丝边框，radius 16px，
  内边距 14px 16px；占位行在上（14px，muted），控件行在下（高 32px）
- 控件 = **离散的圆角描边按钮**（radius 10px、高 30px、border 1px 发丝、
  透明底、hover 淡底、icon 14px + label 13px、gap 6px、padding 0 10px）——
  **不是**胶囊内分段、不是带底色横幅
- 激活态 chip：淡色底（accent-soft / 淡蓝）+ 深色文字 + 右侧 `×`，无边框
- 右侧动作钮：描边矩形 `Run ⏎` 风格（我们的发送/中断复用此形态）
- 单色克制：全行灰白，只有激活 chip 与发送 hover 带色

## 控件映射（离散按钮，每个真实功能）

左组：
1. `⊕` 圆形描边图标钮 `[data-testid="toolbar-attach"]`：引用文件（fs:tree 浅列表
   点选插 `@路径`，现交互保留）
2. `📎` 圆形描边图标钮 `[data-testid="composer-attach"]`：上传图片（V8 既有）
3. `▦ 模型 ∨` 描边标签钮 `[data-testid="toolbar-model"]`：模型预设下拉，
   选择即发 `/model <名>`（现交互保留；label=当前模型截 12 字符）
4. 激活 chip `[data-testid="view-chip"]`：**视图=对话** 时显示 `✦ 对话 ×`，
   点 `×` 切到原始输出（chip 消失）；原始输出视图下不显示 chip。
   —— 对应参考图的 Grounding 激活 chip（带色可移除）
5. `▦ 命令` 描边标签钮 `[data-testid="tools-button"]`：打开斜杠命令面板
   （V4 slash palette 的按钮形态）

右组：
6. 状态徽标 `[data-testid="composer-status"]`：状态点 + 状态词（working 转圈/
   idle 绿/blocked 琥珀/done 蓝），小号弱化（V8 契约保留）
7. `发送 ⏎` 描边钮 `[data-testid="send-button"]`：working 态切换为
   `■ 中断`（红描边）；参考图的 Run 快捷键提示形态（`⏎`）

Esc 中断：保留现状（仅 working 态悬浮胶囊右上角 ghost chip）。

## 移除清单（V7 遗留的臃肿件）

- Double-Bezel 分段胶囊壳与 hairline 竖线分段（改为离散按钮行）
- effort 段（composer-effort）与 mode 段（composer-mode）的**独立段位**——
  并入 `模型 ∨` 下拉菜单底部作为第二分区（菜单内分组：模型预设 / 推理力度 /
  权限模式），testid 保留在菜单项容器上；行内不再各占一位
- agent 徽标段（composer-brand）：删除（agent 身份在 turn-header 已可见）
- 状态环 SVG：改为小号状态点 + 词

## 验收（v7 spec F5 重写，6 例）

- 新按钮组齐全：toolbar-attach / composer-attach / toolbar-model / tools-button /
  view-chip（对话态）/ composer-status / send-button
- 模型下拉选择发 `/model <名>`；tools 按钮打开命令面板；view-chip × 切原始输出；
  attach 插入 @路径
- 几何：控件行单行、按钮两两不相交、发送钮完整可见、无横向溢出
- 视觉（judge 对参考图终审）：按钮形态/间距/单色克制/激活 chip 与参考同构，
  light 主题可直接对齐参考图，dark 同构

## 约束

- V8 spec（composer-attach/composer-status 等 testid）零修改且保持全过
- V2–V6 契约不回退；无新增依赖；安全基线不回退
- spinner/时钟的 GPU 安全与隔离组件（V7 F7）不回退
