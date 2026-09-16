# RESOURCES.md — 前端资源目录

更新：2026-09-16 · 维护规则见 `AGENTS.md` → frontend-skills 区块 E 节。
验证状态分级：**已登记**（仅记录）→ **实际可访问**（入口可达）→ **已取得有效内容**（读到过有效内容）。

## 一、设计参考

| 资源 | 用途 | 入口 | 使用时机 | 读取方式 | 限制 | 验证状态 |
|---|---|---|---|---|---|---|
| mcode 应用（对话数据流参考） | 对话流/turn 结构/文件卡片/状态栏的排版基准 | https://github.com/huangbh2020/mcode.git | 改对话视图、Composer 前对照 | 源码：`apps/desktop/src/renderer/components/chat/`；本地浅克隆曾在 `%TEMP%\mcode-ref`（临时目录，可能被清理，按需重新 `git clone --depth 1`） | 只借鉴显示形态，不引入其 session 体系与依赖 | 已取得有效内容（V5/V7 两轮复刻以此验收） |
| 用户参考截图（Composer 等） | 复刻验收的对照基准 | `C:\Users\Administrator\.zcode\cli\image-cache\`（会话缓存）与对话附件 | 视觉对标、judge 终审 | 直接 Read 图片 | 会话缓存可能清理；截图仅反映当时状态 | 已取得有效内容 |
| 历史视觉基线截图 | 回归对照 | `tests/artifacts/v*.png` | UI 改动前后对比 | 直接 Read | 属构建产物（gitignore），不进版本库 | 已登记 + 实际可访问 |

## 二、组件实现依据（官方文档，按实际版本）

| 资源 | 版本 | 入口 | 使用时机 | 读取方式 | 限制 | 验证状态 |
|---|---|---|---|---|---|---|
| React | 18.3 | https://react.dev/reference ；官方 Markdown：https://react.dev/llms.txt | 组件/钩子语义疑问；先定位具体 API 再读 | llms.txt 全量拉取后**本地检索**，或浏览器读单页；不要整站喂给上下文 | 文档对应 React 最新大版本，与 18.3 有差异时以 18.3 行为为准 | **已取得有效内容**（llms.txt 200，14KB） |
| marked | 18 | https://github.com/markedjs/marked#readme | markdown 渲染行为/扩展选项 | GitHub README / docs/ 目录 | GFM 默认开启；安全过滤在应用层（escapeHtml 先于 parse） | **已取得有效内容**（README 200） |
| highlight.js | 11.12 | https://highlightjs.org/ ；https://github.com/highlightjs/highlight.js | 代码块语言着色/新增语言注册 | 官网 demo + GitHub | 用 core 构建，按需注册语言（现 13 种） | 实际可访问 |
| zustand | 4.5 | https://github.com/pmndrs/zustand | store 模式/selector 性能问题 | GitHub README（即文档） | v4 与 v5 API 有差异，勿混用 | 实际可访问 |
| anser | 2.2 | https://github.com/IonicaBizau/anser | ANSI→HTML 转换行为 | GitHub README | 上游 3.x 有 breaking 变化，勿盲目升级 | 已登记 |
| Electron | 33.2 | https://www.electronjs.org/docs/latest | main/preload/IPC/安全/打包 | 官方文档按页读；安全清单必读 | 与渲染端 React 版本无关；fuses/signing 未配置 | **已取得有效内容**（docs 200，项目 IPC/安全实现多轮评审） |
| Playwright | 见 package.json devDeps | https://playwright.dev/docs/intro | E2E/_electron 驱动写法 | 官方文档按页读 | Electron 驱动走 `_electron.launch`（非 browser） | 已取得有效内容（83 例在跑） |

## 三、图标字体素材

| 资源 | 用途 | 入口 | 使用时机 | 读取方式 | 限制 | 验证状态 |
|---|---|---|---|---|---|---|
| 内联 SVG 图标集 | 全部 UI 图标 | `src/components/icons.tsx`（22 枚自绘，随仓库 MIT） | 需要新图标时先在此文件按同风格手绘 | 直接 import | 无外部运行时请求（已核查 global.css 零 url/@import） | **已取得有效内容** |
| 系统字体栈 | UI/等宽字体 | global.css `--font-ui/--font-mono`（Segoe UI/Cascadia/Consolas 系统栈） | 日常开发无感知 | 系统渲染 | 换字体须同步双主题令牌；禁止引入外部字体请求 | **已取得有效内容** |
| 第三方图标库（lucide 等） | 备选 | — | 仅当自绘覆盖不了且用户同意引入 | — | 未安装；引入需按规则 E 说明必要性 | **待验证**（未安装） |

## 四、辅助设计工具

| 资源 | 用途 | 入口 | 使用时机 | 读取方式 | 限制 | 验证状态 |
|---|---|---|---|---|---|---|
| design-dna skill | 从参考截图提取结构化设计规范 | `.zcode/skills/design-dna/` | 用户提供参考图并要求提取规范 | Skill 加载（AGENTS.md C7） | 不覆盖已确认设计；截图报 bug 时不触发 | 已取得有效内容（已安装+发现） |
| impeccable skill（用户级 v4.0.4） | 视觉实现与设计审查 | `~/.agents/skills/impeccable/` | 设计决策前/完成后走查 | Skill 加载（AGENTS.md C1） | 项目级同名安装会被用户级遮蔽 | 已取得有效内容 |
| Playwright 截图流程 | 视觉验收证据 | `npm run screenshot`；`tests/artifacts/v*-*.mjs` 探针 | UI 改动前后 | capturePage/_electron | 改源码后必须 `npm run build` 再截图（视觉脚本读 dist 产物） | 已取得有效内容 |
| judge 视觉评审流程 | 视觉验收终审 | 主会话派发（附参考图路径） | 视觉改动的对标终审 | Read 截图 + 对标 | 需主会话派发；不能替代几何/单测断言 | 已取得有效内容 |

## 五、待验证资源

| 资源 | 说明 | 状态 |
|---|---|---|
| 灵感站（dribbble/mobbin/land-book 等） | 新设计找参考时**才**检索；使用后需在本文件登记采用点 | 待验证（未登记具体站点，未取得授权确认） |
| Electron fuses/代码签名 | 桌面发布加固 | 待验证（当前未配置签名，打包用 `signAndEditExecutable:false`） |
| 其他 llms.txt 站点（vite/electronjs） | 官方 Markdown 化文档 | 待验证（react.dev 已验证；其余未逐一探测） |
