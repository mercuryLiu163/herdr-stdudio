// F1–F4:V2 PRD(docs/plans/2026-09-09-v2-prd.md)的验收契约骨架。
// TDD 约定:PRD 先行,功能未实现前用 test.fixme 占位;实现时把 fixme 翻成 test 跑绿。
// 选择器一律用 PRD 指定的 data-testid,禁止依赖实现细节。
import { test, expect } from "./support/fixtures.mjs";

test.fixme("F1 日夜模式:默认 dark,toggle 点击后 html[data-theme] 翻转,刷新后保持", async ({ studio }) => {
  const { win } = studio;
  await expect(win.locator("html")).toHaveAttribute("data-theme", "dark");
  await win.getByTestId("theme-toggle").click();
  await expect(win.locator("html")).toHaveAttribute("data-theme", "light");
  await win.reload();
  await expect(win.locator("html")).toHaveAttribute("data-theme", "light");
});

test.fixme("F2 右侧栏:开关、文件树种子条目、md 预览、xyz 显示外部打开按钮", async ({ studio }) => {
  const { win } = studio;
  await win.getByTestId("right-sidebar-toggle").click();
  const tree = win.getByTestId("file-tree");
  await expect(tree).toBeVisible();
  // TODO(实现时确认):active pane 的 cwd 需指向种子目录(tests/fixtures),
  // 可经隔离会话在 pane 内 cd 到种子目录后再打开侧栏
  await expect(win.getByTestId("file-item").filter({ hasText: "sample.md" })).toBeVisible();
  await win.getByTestId("file-item").filter({ hasText: "sample.md" }).click();
  await expect(win.getByTestId("file-preview").getByRole("heading")).toBeVisible();
  await win.getByTestId("file-item").filter({ hasText: "sample.png" }).click();
  await expect(win.getByTestId("file-preview").locator("img")).toBeVisible();
  await win.getByTestId("file-item").filter({ hasText: "sample.xyz" }).click();
  await expect(win.getByTestId("open-external")).toBeVisible(); // 按契约不点击
});

test.fixme("F3 双模式:默认 separate,切 unified 出马赛克且各 cell 含自身标记,拖分隔条尺寸变化", async ({ studio }) => {
  const { win } = studio;
  await expect(win.getByTestId("layout-separate")).toHaveAttribute("aria-pressed", /true/);
  await win.getByTestId("layout-unified").click();
  const mosaic = win.getByTestId("mosaic");
  await expect(mosaic).toBeVisible();
  // 造数据:向 tab 内各 pane 分别 echo 唯一标记,断言 cell 数 = pane 数且各自包含标记
  // cell 包围盒尺寸变化用 boundingBox() 拖动前后对比(见 PRD F3 验收)
});

test.fixme("F4 对话视图:agent pane 默认对话流,用户消息气泡/工具卡片与原始输出三档切换", async ({ studio }) => {
  const { win, session } = studio;
  // 造数据:report_agent 注册 fake agent → 在该 pane echo 带标记的对话样例
  // 断言:对话视图渲染用户气泡与 assistant 正文;切「原始输出」后退回 ANSI 倾倒
  expect(studio.session.name).toBeTruthy();
});
