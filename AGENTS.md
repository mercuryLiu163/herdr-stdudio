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

<!-- frontend-skills:start -->
# 前端 Skills 规则（frontend-skills）

安装位置：`.zcode/skills/`（playwright-skill / web-component-design / accessibility /
performance / electron-development / design-dna）；impeccable 为用户级
（`~/.agents/skills/impeccable`，v4.0.4，ZCode 已发现——项目级同名安装会被用户级
遮蔽，故复用用户级）。元数据与来源哈希见 `skills-lock.json`。

## A. 通用开发约束

1. 默认沿用现有技术栈（Electron + React/Vite + TypeScript + npm + Playwright）、组件库、设计规范和业务流程。
2. 以用户确认的 DESIGN.md 为设计依据；本仓库暂无该文件时先沿用现有界面和组件事实，不杜撰"已确认"的设计。
3. 工具型界面优先信息清晰、操作效率、状态反馈和合适的信息密度。
4. 不因 Skill 偏好强行替换字体、图标、组件库、主题或引入装饰动画。
5. 普通修改先做最小实现和相关验证，不扩展成全站重设计。
6. 新增依赖必须说明必要性，不能只因 Skill 示例使用某个库就引入。
7. 视觉修改不得擅自改变 API、IPC、权限和业务行为。
8. Electron 安全敏感实现按项目实际版本（见 package.json 的 electron 字段）核对官方安全要求，检查 IPC 来源与参数、preload 暴露面及文件路径边界；第三方示例不是安全认证。
9. 区分真实执行、模拟验证、静态检查和未验证项。
10. 视觉任务完成时提供相关截图；非视觉任务不强制生成无关截图。

## B. Skill 选择与加载

- 根据用户目标、实际变更范围和执行阶段选用 Skill，不只按关键词匹配。
- 命中下面条件时，在对应工作开始前实际加载指定 Skill（调用技能机制，或读取
  `.zcode/skills/<name>/SKILL.md` 并按其指导执行；不是只在回复里提到名称）。
- 只读取当前任务需要及 Skill 明确要求的参考资料，不预加载整个文档集合。
- 已加载且仍在上下文中的内容不重复读取；上下文丢失后可以按需重读。
- 找不到 Skill 时说明缺失，不虚构使用成功；可以继续安全且独立的工作，注明缺口。
- 非简单任务开始时，用一句话说明选择了哪些 Skill、分别用于什么。
- 不设置机械的"一次最多几个"限制；真正相关的可以分阶段使用，无关的不能加载。

## C. 明确的触发规则

1. **impeccable**（用户级）
   触发：新页面设计、页面美化、布局、视觉层级、主题调整、设计审查。
   时机：设计或样式决策前；完成后检查受影响页面。
   边界：不默认全站重设计；明确数值的机械性样式小改不强制触发。
2. **web-component-design**
   触发：新建可复用组件、复杂组件拆分、组件接口设计、组件库或组件级重构。
   时机：确定组件边界和接口前。
   边界：普通文案修改、现有组件简单属性调整不触发；不把它当成万能应用架构技能。
3. **playwright-skill**
   触发：新增或修改关键交互流程、复现交互缺陷、编写或修复端到端测试；
   以及 Electron 启动、窗口、IPC、原生集成、打包产物的自动化测试。
   时机：缺陷任务优先复现；实现后验证受影响流程。
   边界：优先复用现有测试（tests/playwright/、tests/run-all.mjs），不自动全量回归；
   Electron 任务按需读取对应专章；模拟原生对话框不等于真实系统交互已经通过。
4. **accessibility**
   触发：新建或实质修改表单、弹窗、菜单、键盘交互、焦点管理；
   修改文字与背景配色影响对比度；或明确的可访问性问题。
   时机：相关交互设计时及修改后的验证阶段。
   边界：默认仅检查受影响区域，全站审计需要明确任务要求。
5. **performance**
   触发：加载慢、渲染卡顿、大列表或日志浏览瓶颈、明确的性能审计或验收。
   时机：修改前采集基线，定位后修改，再按相同条件复测。
   边界：不能仅因出现"优化"二字就触发；不能把后端或网络延迟直接归为前端问题。
6. **electron-development**
   触发：新建 Electron 外壳，或修改 main、preload、IPC、原生文件能力、
   窗口生命周期、桌面安全边界、打包更新。
   时机：接口与边界设计前，完成后复核相关桌面行为和安全约束。
   边界：仅修改 Electron 渲染页面的普通样式，不自动触发。
7. **design-dna**
   触发：用户提供参考截图、图片或页面，要求分析风格、提取规范或按参考实现。
   时机：实现前分析参考，明确测量、推断和无法判断的内容，再映射到现有设计规范。
   边界：截图仅用于报告 bug 时不触发；没有参考或提取需求时不触发。
   不自行覆盖已确认的 DESIGN.md，不杜撰截图未展示的行为。

## D. 协作顺序与停止条件

- 有参考设计：design-dna 分析，再交给 impeccable 按已确认规范实现。
- 涉及组件结构：编码前使用 web-component-design。
- 涉及桌面边界：接口设计前使用 electron-development。
- 验证阶段：按实际变化调用 playwright-skill、accessibility、performance。
- 专项问题由专项 Skill 主导，避免多个 Skill 重复进行同一套全量审计。
- 排查中发现新的实际影响范围，再补充对应 Skill，不提前全加载。
- 只要求审查的任务只输出发现和建议，不自动改代码。
- 机械性小改可以不加载专项 Skill，但仍要做必要验证。
- 按验收条件结束；没有新问题时不重复截图、审查和微调。
- 不得为了快速结束而跳过失败项并宣称通过。

## E. 资源使用条件（RESOURCES.md / COMPONENTS.md）

- 前端资源目录：`docs/frontend/RESOURCES.md`；组件使用映射：`docs/frontend/COMPONENTS.md`。先查这两份与现有组件，再查官方文档；官方文档有 Markdown/llms.txt（如 react.dev/llms.txt）优先用。
- 新设计、用户明确找参考、或规范存在缺口时，才检索外部灵感站；检索后须在 `docs/frontend/RESOURCES.md` 登记采用点、不采用点、来源与对应实现位置。
- 参考图分析用 design-dna，视觉实现用 impeccable，组件设计用 web-component-design——并以实际组件 API 与 `COMPONENTS.md` 映射为依据。
- 外部参考（含参考截图、第三方示例）不能自动覆盖已确认的设计规范与业务行为。
- 项目零外部运行时请求（字体/图标/样式全本地）：不得引入外部字体、CDN 图标或运行时素材请求；新素材须核对许可并在 RESOURCES.md 登记。
- 普通小改不启动外部灵感检索，不遍历收藏网站。
<!-- frontend-skills:end -->
