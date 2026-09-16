// V5 feature acceptance tests — executable contract of docs/plans/2026-09-12-v5-prd.md
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as cp from "node:child_process";
import { launchStudio, FIXTURES } from "./fixtures.mjs";
import { api } from "../helpers/herdr-api.mjs";

let ctx;

test.beforeEach(async () => {
  ctx = await launchStudio();
});

test.afterEach(async () => {
  await ctx.close();
  ctx = null;
});

// A tiny git repo inside fixtures with one commit + one modified + one new file.
const GITREPO = path.join(FIXTURES, "git-proj");
function ensureGitRepo() {
  // NOTE(test-fix): wipe any previous run's repo AND worktree leftovers before
  // seeding. `rm -rf .git` alone still lets `add -A` sweep a stale
  // src/index.js / README.md from the last run into the init commit, which
  // silently changes the promised status/diff (modified src/index.js +
  // untracked README.md). Recreating the tree makes every run deterministic.
  cp.execSync("rm -rf .git src README.md", { cwd: GITREPO, stdio: "ignore", shell: "bash" });
  fs.mkdirSync(path.join(GITREPO, "src"), { recursive: true });
  cp.execSync("git init -b main", { cwd: GITREPO, stdio: "ignore" });
  cp.execSync('git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -m init || true', {
    cwd: GITREPO, stdio: "ignore", shell: "bash",
  });
  fs.writeFileSync(path.join(GITREPO, "src", "index.js"), "console.log(1);\n");
  cp.execSync("git add -A && git -c user.email=t@t -c user.name=t commit -m second || true", {
    cwd: GITREPO, stdio: "ignore", shell: "bash",
  });
  fs.writeFileSync(path.join(GITREPO, "src", "index.js"), "console.log(2); // modified\n");
  fs.writeFileSync(path.join(GITREPO, "README.md"), "# git-proj\n");
}

async function seedAgent() {
  const { sock, pane2 } = ctx;
  // user -> tool (with file paths) -> meta -> assistant: one full turn
  await api.paneSendInput(
    sock,
    pane2.pane_id,
    'echo "\u276f \u6574\u7406\u4e00\u4e0b\u9879\u76ee"; echo "\u23fa Edit(src/index.js)"; echo "src/index.js  src/app.ts"; echo "\u273b Worked for 12s"; echo "\u5df2\u5b8c\u6210\u3002\u5982\u6709\u95ee\u9898\u8bf7\u544a\u77e5\u3002"',
  );
  await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
  const { page } = ctx;
  await page.waitForFunction(
    (pid) => window.__herdr_store.getState().agents.some((a) => a.pane_id === pid),
    pane2.pane_id,
    { timeout: 10000 },
  );
  await page.locator(".pane-chip").filter({ hasText: /e2e-fake agent|E2E/ }).first().click().catch(() => {});
}

// ---------- F1 对话显示效果复刻 ----------
test.describe("F1 turn display", () => {
  // NOTE(test-fix): V9 (docs/plans/2026-09-16-v9-datastream-style.md, F1 回合
  // 分隔丸) replaced the old header bar (avatar + agent name + step/file chips)
  // with a centered divider pill `› HH:MM:SS · 时长`. The contract migrates to
  // the new form: pill exists on the hairline, carries the isolated HH:MM:SS
  // clock and the turn duration, and still collapses/expands the turn body.
  // Avatar/name/step/file assertions are deliberately INVERTED (must NOT be
  // present — the reference pill has none of them).
  test("回合分隔丸：时间 + 时长 + 折叠（无头像/名称/步数/文件 chips）", async () => {
    await seedAgent();
    const { page } = ctx;
    const header = page.getByTestId("turn-header").first();
    await expect(header).toBeVisible();
    const pill = header.getByTestId("turn-pill");
    await expect(pill).toBeVisible();
    // V9 F1: no avatar initials, no agent display name, no step/file chips
    await expect(pill).not.toContainText("e2e-fake");
    await expect(pill).not.toContainText(/步/);
    await expect(pill).not.toContainText(/文件/);
    // isolated clock keeps the HH:MM:SS format (V7 `.turn-time` contract)
    await expect(pill.locator(".turn-time")).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    // duration chip appears only if meta present in turn (seed: Worked for 12s)
    await expect(pill).toContainText("12s");
    // collapse interaction: chevron click hides turn body
    const body = page.getByTestId("chat-immersive").locator("[data-testid='msg-tool']").first();
    await expect(body).toBeVisible();
    await header.locator("[data-testid='turn-collapse']").click();
    await expect(body).toBeHidden();
    await header.locator("[data-testid='turn-collapse']").click();
    await expect(body).toBeVisible();
  });

  test("逐 turn 修改文件卡片：折叠文案 + 展开文件行", async () => {
    await seedAgent();
    const { page } = ctx;
    const card = page.getByTestId("turn-files-card").first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("2 个文件");
    // folded by default: rows hidden
    await expect(page.getByTestId("turn-file-row")).toHaveCount(0);
    await card.locator("[data-testid='turn-files-toggle']").click();
    await expect(page.getByTestId("turn-file-row")).toHaveCount(2);
    await expect(page.getByTestId("turn-file-row").first()).toContainText("src/index.js");
  });

  test("markdown 表格渲染为带边框样式", async () => {
    const { sock, pane2 } = ctx;
    await api.paneSendInput(
      sock,
      pane2.pane_id,
      'echo "\u276f \u7ed9\u4e2a\u8868\u683c"; echo "| \u533a\u5757 | \u5185\u5bb9 |"; echo "| --- | --- |"; echo "| Hero | \u9996\u5c4f |"; echo "| \u5de5\u5177 | \u516d\u7c7b\u5de5\u5177 |"; echo "\u273b Baked for 5s"',
    );
    await api.paneReportAgent(sock, pane2.pane_id, "e2e-fake", "working");
    const { page } = ctx;
    await page.locator(".pane-chip").filter({ hasText: /e2e-fake agent|E2E/ }).first().click().catch(() => {});
    const table = page.getByTestId("chat-immersive").locator("table").first();
    await expect(table).toBeVisible();
    await expect(table).toContainText("区块");
    const bw = await table.evaluate((el) => {
      const td = el.querySelector("td, th");
      return td ? getComputedStyle(td).borderTopWidth : "0px";
    });
    expect(parseFloat(bw)).toBeGreaterThan(0);
  });
});

// ---------- F2 右侧栏应用化 ----------
test.describe("F2 sidebar apps", () => {
  test("应用切换条存在，files 应用回归（v2 契约不回退）", async () => {
    const { page } = ctx;
    await expect(page.getByTestId("sidebar-apps")).toBeVisible();
    await page.getByTestId("sidebar-apps").locator("[data-testid='sidebar-app-files']").click();
    await expect(page.getByTestId("right-sidebar")).toBeVisible();
    await expect(page.getByTestId("file-tree")).toBeVisible();
  });

  test("git 应用：分支 + 变更文件列表 + 点击看 diff", async () => {
    ensureGitRepo();
    const { page } = ctx;
    await page.getByTestId("sidebar-apps").locator("[data-testid='sidebar-app-git']").click();
    const panel = page.getByTestId("sidebar-panel-git");
    await expect(panel).toBeVisible();
    // switch cwd-select to the git repo (pick option whose value contains git-proj)
    const value = await page.evaluate(() => {
      const sel = document.querySelector("[data-testid='cwd-select']");
      const opt = [...sel.options].find((o) => o.value.includes("git-proj"));
      return opt ? opt.value : null;
    });
    expect(value, "cwd options should contain git-proj").toBeTruthy();
    await page.getByTestId("cwd-select").selectOption(value);
    // NOTE(test-fix): the panel may still be rendering the PREVIOUS directory's
    // status here — the project root is also on branch "main", so the branch
    // assertion cannot distinguish stale from fresh, and the row list used to
    // be read before the git-proj refetch landed (intermittent failure under
    // load). Wait for the freshly fetched repo's own change row first; every
    // assertion below is then guaranteed to see the switched directory.
    await panel
      .getByTestId("git-file")
      .filter({ hasText: "src/index.js" })
      .first()
      .waitFor({ state: "visible", timeout: 15000 });
    await expect(panel.getByTestId("git-branch")).toContainText("main");
    const rows = panel.getByTestId("git-file");
    await expect(rows.first()).toBeVisible();
    const texts = await rows.allTextContents();
    expect(texts.join("\n")).toContain("src/index.js");
    // click changed file -> diff preview shows +/- content
    await rows.filter({ hasText: "src/index.js" }).first().click();
    const preview = page.getByTestId("file-preview");
    await expect(preview).toContainText("+console.log(2)");
  });

  test("非 git 目录显示明确空态", async () => {
    const { page } = ctx;
    await page.getByTestId("sidebar-apps").locator("[data-testid='sidebar-app-git']").click();
    const panel = page.getByTestId("sidebar-panel-git");
    // default cwd = project root IS a git repo; pick a non-repo dir if available,
    // otherwise assert repo root shows branch (graceful either way).
    const value = await page.evaluate(() => {
      const sel = document.querySelector("[data-testid='cwd-select']");
      const opt = [...sel.options].find((o) => o.value.includes("fixtures"));
      return opt ? opt.value : null;
    });
    if (value) {
      await page.getByTestId("cwd-select").selectOption(value);
      // fixtures itself is not a repo (only git-proj subdir) -> empty state
      await expect(panel.locator("[data-testid='git-empty']")).toBeVisible();
    } else {
      await expect(panel.getByTestId("git-branch")).toBeVisible();
    }
  });

  test("应用选择持久化", async () => {
    const { page } = ctx;
    await page.getByTestId("sidebar-apps").locator("[data-testid='sidebar-app-git']").click();
    await page.getByTestId("right-sidebar-toggle").click().catch(() => {});
    await page.reload();
    await page.waitForFunction(() => !!window.__herdr_store?.getState()?.booted, null, { timeout: 20000 });
    await page.getByTestId("right-sidebar-toggle").click();
    await expect(page.getByTestId("sidebar-panel-git")).toBeVisible();
  });
});
