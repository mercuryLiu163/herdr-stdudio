# frontend-skills-setup — 安装与验收报告

日期：2026-09-16 · 执行环境：Windows / ZCode CLI 0.16.5 / Node v24.13.0 / npm 11.10.1
项目：`E:\MyCode\herdr studio`（Herdr Studio — Electron 33 + React 18/Vite 5 + TypeScript + npm + Playwright，单项目工作区）

## 1. 范围与适配 Agent

- 安装范围：**仅本项目**（项目级），未做任何全局安装，未触碰其他仓库。
- 适配 Agent：**ZCode**（当前 Agent，CLI 原生支持，安装目标 `.zcode/skills/`）。
  项目内未发现其他 Agent 配置目录（无 `.claude/`、`.codex/` 等），未为其创建配置。
- 规则入口：`AGENTS.md`（项目唯一规则文件；无 override/CLAUDE.md）。

## 2. 七个 Skill 安装结果

| # | 技能（SKILL.md 实际 name） | 来源 | 安装路径 | 状态 | 版本/哈希证据 |
|---|---|---|---|---|---|
| 1 | impeccable | pbakaus/impeccable | **复用用户级** `~/.agents/skills/impeccable/`（SKILL.md+agents/+reference/+scripts/，v4.0.4） | 复用 | 上游 main f2c70518；本地 frontmatter version 4.0.4 |
| 2 | web-component-design | wshobson/agents（plugins/ui-design/skills/） | `.zcode/skills/web-component-design/` | 新安装 | 上游 4236bb91；lock 哈希见 skills-lock.json |
| 3 | playwright-skill | testdino-hq/playwright-skill | `.zcode/skills/playwright-skill/`（含 ci/core/migration/playwright-cli/pom） | 新安装 | 上游 400e4256；lock 哈希已记 |
| 4 | accessibility | addyosmani/web-quality-skills（skills/） | `.zcode/skills/accessibility/` | 新安装 | 上游 afa8da94；lock 哈希已记 |
| 5 | performance | addyosmani/web-quality-skills（skills/） | `.zcode/skills/performance/` | 新安装 | 上游 afa8da94；lock 哈希已记 |
| 6 | electron-development | sickn33/antigravity-awesome-skills（skills/） | `.zcode/skills/electron-development/` | 新安装 | 上游 fd1fdf5b；lock 哈希已记 |
| 7 | design-dna | zanwei/design-dna | `.zcode/skills/design-dna/`（含 references/ scripts/ docs/） | 新安装 | 上游 593e39bc；lock 哈希已记 |

- 上游 HEAD SHA 为安装当日 `gh api repos/<repo>/commits/HEAD` 实查值；内容哈希记录于
  项目根 `skills-lock.json`（skills CLI 自动生成）。
- **impeccable 复用说明（冲突记录）**：用户级已存在同来源、同 name（v4.0.4）且
  ZCode 已发现（`zcode skills list` 可见，user/agents 组）。按官方发现顺序，用户级
  (3) 先于工作区 (4/5)，项目级同名安装会被遮蔽而成为死拷贝 → 按复用规则不重复
  安装，未发生覆盖。
- 安装方式记录：`npx skills add <repo> --skill <name> --agent zcode --yes`
  （已先核对 `--help`；该 CLI 原生支持 `ZCode` 目标，copy 到 `.zcode/skills/`，
  并生成 skills-lock.json）。`npx impeccable install` 路线因复用未使用。
- 资源完整性：6 个新装目录均含 SKILL.md + references/（design-dna 另含
  scripts/ docs/，playwright-skill 含 ci/core/migration 等），非单文件拷贝。
- 无多装：`.zcode/skills/` 仅上述 6 目录；大仓库（183/2038 skills）经
  `--skill <name>` 过滤未带入其他顶层技能。

## 3. 规则文件修改

- `AGENTS.md`：文件尾追加标记块
  `<!-- frontend-skills:start --> … <!-- frontend-skills:end -->`，含
  A 通用约束（10 条）/ B 选择与加载 / C 触发规则（7 技能各一）/ D 协作顺序与
  停止条件 / E 资源使用条件（追加任务新增，指向 RESOURCES.md 与 COMPONENTS.md）。
- 读取方式：ZCode 将工作区 `AGENTS.md` 作为规则上下文加载（本会话即以其为工作区
  指令）；标记块为增量追加，原有规则一字未改，无引用循环。
- 无 CLAUDE.md/AGENTS.override.md，无需处理引用或覆盖。

## 4. 验收结果

| 项 | 结果 | 证据 |
|---|---|---|
| 文件完整性 | ✅ 通过 | 6 目录 + SKILL.md frontmatter name 逐一核对（accessibility/design-dna/electron-development/performance/playwright-skill/web-component-design），资源目录完整；impeccable 用户级结构完整 |
| Agent 发现 | ✅ 通过 | `zcode skills list`：6 个新技能均标记 `(project/zcode)`，impeccable 标记 `(user/agents)`；共 48 项无同名遮蔽警告 |
| 实际加载 | ✅ 部分 | 本会话有技能加载记录：zcode-guide:diagnosing-skills（官方发现顺序依据）与 impeccable（读取 SKILL.md 并采纳其"Setup/设计原则"措辞）；6 个新技能有 SKILL.md 文件读取记录（frontmatter 核对） |
| 路由静态检查 | ✅ 8/8 | a→impeccable；b→web-component-design（不强制视觉）；c→playwright 复现+按需 electron-development；d→accessibility(+playwright)；e→performance 先测量；f→design-dna→impeccable；g/h→不触发。逐条对照规则文本断言通过 |
| 真实触发验证 | ⏸ 待验证 | 无法从本会话内新建另一个 Agent 会话做端到端触发探针。建议：新开一个 ZCode 会话，输入验收用例 a–h 观察技能自动加载（`/skill` 或技能机制调用记录） |

## 5. 追加任务（资源目录与组件映射）

- `docs/frontend/RESOURCES.md`：设计参考 / 组件实现依据 / 图标字体素材 /
  辅助设计工具 / 待验证资源，五类逐项登记（用途/入口/时机/读取方式/限制/验证状态）。
- `docs/frontend/COMPONENTS.md`：业务场景 → 组件路径 → 底层库 → 状态约束映射
  （含缺失组件如实标记：虚拟列表/通用按钮抽象/Table 组件/xterm 真终端）。
- AGENTS.md 块内新增 E 节「资源使用条件」（先项目规范→官方文档→灵感站；
  design-dna/impeccable/web-component-design 分工；外部参考不自动覆盖规范；
  检索后登记；零外部运行时请求约束）。

## 6. 缺口与待验证项

1. **真实自动触发待验证**（见上）——需要用户开新会话做路由探针；本会话无法代验。
2. impeccable 的 runtime 依赖未逐一执行：其 Setup 要求运行
   `node <skill>/scripts/context.mjs`（依赖用户项目内 PRODUCT.md/DESIGN.md，
   本仓库暂无这两个文件）——首次真实使用时按其指引补齐或忽略。
3. 技能文档对应上游最新版（React 19 / Electron 36 等）与项目锁定版本（React 18 /
   Electron 33）存在版本差，规则 A2/A8 已声明以项目实际版本为准。
4. skills-lock.json 为 skills CLI 私有格式，其他 Agent 不读取——仅作本项目版本溯源。

## 7. 回退方式

```bash
# 1) 撤销 AGENTS.md 的追加块（保留其他内容）：
#    删除 <!-- frontend-skills:start --> 到 <!-- frontend-skills:end --> 之间的内容
git checkout -- AGENTS.md          # 若未提交且 AGENTS.md 此前无其他改动
# 2) 移除项目级技能与锁文件：
rm -rf .zcode/skills skills-lock.json docs/frontend
# 3) 用户级 impeccable 为既有资产，无需回退
```

重复执行安全性：规则块有 start/end 标记（脚本断言防重复追加）；技能安装为
copy 幂等（同源覆盖同内容）；无 hooks 新增，未动用户级目录。
