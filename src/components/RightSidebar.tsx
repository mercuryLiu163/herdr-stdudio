import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { useStore, type SidebarApp } from "../store";
import type { FsNode, FilePreview, GitStatus, GitStatusEntry } from "../types";
import { IconBranch, IconChevron, IconFile, IconFolder, IconOpenExternal } from "./icons";

/**
 * F2 right tool sidebar (ChatGPT Desktop style), V5 F2 app-ified:
 *   - `SidebarAppRail`: always-visible app switcher strip (files / git);
 *     selection persists in localStorage `herdr-studio-sidebar-app`
 *   - cwd quick-switcher over the workspaces' known pane cwds plus the
 *     subdirectories discovered in the file tree (so a repo nested under a
 *     pane cwd, e.g. tests/fixtures/git-proj, is directly selectable)
 *   - files app: project file tree rooted at the selected cwd (depth 3) +
 *     preview (markdown → HTML, images inline, text in <pre>)
 *   - git app: branch + working-tree changes (`git status --porcelain=v1 -b`,
 *     directory-scoped: the selected cwd must be the repo root) and a
 *     per-file diff rendered through the same escaped <pre> channel as the
 *     text preview
 */

const TREE_DEPTH = 3;
const MARKDOWN_EXT = new Set([".md", ".markdown"]);
/** Cap on quick-switcher entries so a huge tree cannot flood the <select>. */
const MAX_CWD_OPTIONS = 80;

/** Escape raw HTML so marked output can never inject markup from file contents. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Link guard: only http/https hrefs survive; anything else (file:, javascript:,
 * relative paths, …) is stripped to plain text. Safe anchors open externally.
 */
function sanitizeMarkdownHtml(html: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("a").forEach((a) => {
    const href = (a.getAttribute("href") ?? "").trim();
    if (/^https?:\/\//i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else {
      a.replaceWith(document.createTextNode(a.textContent ?? ""));
    }
  });
  return tpl.innerHTML;
}

function renderMarkdown(src: string): string {
  return sanitizeMarkdownHtml(marked.parse(escapeHtml(src), { async: false }) as string);
}

function basename(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;
}

function prettyRoot(p: string): string {
  const base = basename(p);
  return base.length > 28 ? base.slice(0, 27) + "…" : base;
}

/** The porcelain letter this entry is summarized by (M / A / D / ?? …). */
function statusLetter(en: GitStatusEntry): string {
  if (en.x !== " " && en.x !== "?") return en.x;
  if (en.y !== " " && en.y !== "?") return en.y;
  return "??";
}

/** CSS class suffix for the status tint: M yellow / A green / D red / ?? gray. */
function statusClass(en: GitStatusEntry): string {
  const letter = statusLetter(en);
  if (letter === "??") return "untracked";
  if (letter === "A") return "added";
  if (letter === "D") return "deleted";
  if (letter === "M") return "modified";
  return "other";
}

function isUntracked(en: GitStatusEntry): boolean {
  return en.x === "?" || en.y === "?";
}

/** Collect every directory path from a file tree, depth-first, preserving order. */
function collectDirs(nodes: FsNode[], out: string[]): void {
  for (const n of nodes) {
    if (n.type !== "dir" || out.length >= MAX_CWD_OPTIONS * 2) continue;
    if (!out.includes(n.path)) out.push(n.path);
    if (n.children?.length) collectDirs(n.children, out);
  }
}

/**
 * Always-visible app switcher for the right sidebar (mcode-style icon strip).
 * Lives OUTSIDE the collapsible sidebar container so an app can be opened
 * straight from the closed state; choosing an app opens the sidebar.
 */
export function SidebarAppRail() {
  const app = useStore((s) => s.sidebarApp);
  const setApp = useStore((s) => s.setSidebarApp);
  const open = useStore((s) => s.rightSidebarOpen);
  const toggle = useStore((s) => s.toggleRightSidebar);

  const choose = (a: SidebarApp) => {
    setApp(a);
    if (!open) toggle();
  };

  return (
    <div className="rs-apps" data-testid="sidebar-apps">
      <button
        className={`sidebar-app-btn ${app === "files" ? "active" : ""}`}
        data-testid="sidebar-app-files"
        title="文件"
        aria-label="文件"
        onClick={() => choose("files")}
      >
        <IconFolder size={16} />
      </button>
      <button
        className={`sidebar-app-btn ${app === "git" ? "active" : ""}`}
        data-testid="sidebar-app-git"
        title="Git"
        aria-label="Git"
        onClick={() => choose("git")}
      >
        <IconBranch size={16} />
      </button>
    </div>
  );
}

export function RightSidebar() {
  const panes = useStore((s) => s.panes);
  const activePaneId = useStore((s) => s.activePaneId);
  const app = useStore((s) => s.sidebarApp);
  const sidebarRoot = useStore((s) => s.sidebarRoot);
  const setSidebarRoot = useStore((s) => s.setSidebarRoot);
  const activeCwd = useMemo(
    () => panes.find((p) => p.pane_id === activePaneId)?.cwd ?? null,
    [panes, activePaneId],
  );

  // Deduplicated cwds across the snapshot (workspace quick-switch).
  const cwds = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of panes) {
      const cwd = (p.cwd ?? "").trim();
      if (!cwd || seen.has(cwd)) continue;
      seen.add(cwd);
      out.push(cwd);
    }
    return out;
  }, [panes]);

  // Manual cwd choice lives in the store: closing the sidebar unmounts this
  // component, and the choice must survive that (reopen shows the same
  // directory instead of silently snapping back to the pane cwd).
  const root = sidebarRoot ?? activeCwd;

  // Following the active pane wins over a stale manual choice — but only on
  // an ACTUAL cwd change (non-null → different non-null). Transient nulls
  // (partial snapshots / pane churn while the herdr session settles) and the
  // boot-time null → cwd arrival must not wipe a manual pick the user already
  // made: the wipe used to fire there, the panel fell back to the pane cwd and
  // its upward repo detection rendered the PARENT repo's status over the
  // selected one (v5 F2 flake). The effect also runs on mount, and blindly
  // resetting there would wipe the persisted manual choice every time the
  // sidebar is reopened (the store survives the unmount; that's the point).
  const prevCwdRef = useRef(activeCwd);
  useEffect(() => {
    if (prevCwdRef.current === activeCwd) return;
    if (activeCwd !== null && prevCwdRef.current !== null) setSidebarRoot(null);
    prevCwdRef.current = activeCwd;
  }, [activeCwd, setSidebarRoot]);

  const [tree, setTree] = useState<FsNode[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    setTreeError(null);
    if (!root) return;
    window.herdr
      .fsTree(root, TREE_DEPTH)
      .then((res) => {
        if (cancelled) return;
        if (Array.isArray(res)) setTree(res);
        else setTreeError(res.error);
      })
      .catch((err: any) => {
        if (!cancelled) setTreeError(String(err?.message ?? err));
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  // Quick-switcher options: the snapshot's pane cwds first, then the CURRENT
  // root (so the <select> always has an option matching its own value —
  // without this, a selected tree subdirectory displays as the first option
  // after its tree is refetched), then every directory discovered in the
  // current tree — this is how a repository nested under a pane cwd (e.g.
  // tests/fixtures/git-proj) becomes selectable for the Git app.
  const cwdOptions = useMemo(() => {
    const out = [...cwds];
    if (root && !out.includes(root)) out.push(root);
    if (tree?.length) collectDirs(tree, out);
    return out.slice(0, MAX_CWD_OPTIONS);
  }, [cwds, root, tree]);

  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const openFile = async (node: FsNode) => {
    if (node.type !== "file") return;
    setPreviewError(null);
    setPreview(null);
    try {
      setPreview(await window.herdr.fsRead(node.path));
    } catch (err: any) {
      setPreviewError(String(err?.message ?? err));
    }
  };

  return (
    <div className="right-sidebar" data-testid="right-sidebar">
      <div className="rs-section rs-cwd">
        <div className="side-heading">工作目录</div>
        <select
          className="rs-select"
          data-testid="cwd-select"
          value={root ?? ""}
          onChange={(e) => setSidebarRoot(e.target.value)}
        >
          {cwdOptions.length === 0 && <option value="">（无已知目录）</option>}
          {cwdOptions.map((cwd) => (
            <option key={cwd} value={cwd}>
              {cwd}
            </option>
          ))}
        </select>
      </div>

      {app === "git" ? (
        <GitPanel root={root} />
      ) : (
        <>
          <div className="rs-section rs-tree">
            <div className="side-heading">{root ? prettyRoot(root) : "文件树"}</div>
            <div className="rs-tree-scroll" data-testid="file-tree">
              {treeError && <div className="rs-hint">读取目录失败：{treeError}</div>}
              {!treeError && tree === null && <div className="rs-hint">{root ? "读取中…" : "选择一个窗格后显示文件树。"}</div>}
              {tree !== null && tree.length === 0 && <div className="rs-hint">这个目录是空的。</div>}
              {tree !== null && tree.length > 0 && <TreeNodes nodes={tree} depth={0} onOpen={openFile} />}
            </div>
          </div>

          <div className="rs-section rs-preview">
            <div className="side-heading">预览</div>
            <div className="rs-preview-body" data-testid="file-preview">
              {previewError && <div className="rs-hint">读取失败：{previewError}</div>}
              {!previewError && !preview && <div className="rs-hint">点击文件树中的文件进行预览。</div>}
              {preview && preview.kind === "image" && (
                <div className="rs-image">
                  <img src={preview.data} alt={basename(preview.path)} />
                  <div className="rs-file-name">{basename(preview.path)}</div>
                </div>
              )}
              {preview && preview.kind === "text" && <MarkdownOrText path={preview.path} text={preview.data} />}
              {preview && preview.kind === "other" && (
                <div className="rs-other">
                  <div className="rs-hint">无法预览此文件类型。</div>
                  <button
                    className="rs-open-btn"
                    data-testid="open-external"
                    onClick={() => void window.herdr.fsOpen(preview.path)}
                  >
                    <IconOpenExternal />
                    在默认应用中打开
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * V5 F2 Git app: branch + working-tree change list of the selected directory
 * (root-scoped repo detection happens in the main process), plus a diff
 * preview reusing the sidebar's escaped-text preview channel.
 */
function GitPanel({ root }: { root: string | null }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  type DiffView = { path: string; text?: string; untracked?: boolean; failed?: string };
  const [diff, setDiff] = useState<DiffView | null>(null);
  // Mirrors `root` for async continuations: if the user switches cwd while a
  // git:diff IPC is in flight, the stale result must not land in the new
  // directory's panel.
  const rootRef = useRef(root);
  useEffect(() => {
    rootRef.current = root;
  }, [root]);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setError(null);
    setDiff(null);
    if (!root) return;
    window.herdr
      .gitStatus(root)
      .then((res) => {
        if (!cancelled) setStatus(res);
      })
      .catch((err: any) => {
        if (!cancelled) setError(String(err?.message ?? err));
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const openDiff = async (en: GitStatusEntry) => {
    const rootAtCall = root;
    if (!rootAtCall) return;
    setDiff({ path: en.path });
    if (isUntracked(en)) {
      // git diff is empty for untracked paths — show an explicit placeholder.
      setDiff({ path: en.path, untracked: true });
      return;
    }
    try {
      const res = await window.herdr.gitDiff(rootAtCall, en.path);
      if (rootRef.current !== rootAtCall) return; // cwd switched mid-flight
      setDiff({ path: en.path, text: res.diff ?? "" });
    } catch (err: any) {
      if (rootRef.current !== rootAtCall) return;
      setDiff({ path: en.path, failed: String(err?.message ?? err) });
    }
  };

  return (
    <>
      <div className="rs-section rs-tree" data-testid="sidebar-panel-git">
        <div className="side-heading">Git 变更</div>
        <div className="rs-tree-scroll">
          {error && <div className="rs-hint">读取 Git 状态失败：{error}</div>}
          {!error && !root && <div className="rs-hint">选择一个目录。</div>}
          {!error && root && status === null && <div className="rs-hint">读取中…</div>}
          {status?.notRepo && (
            <div className="rs-hint" data-testid="git-empty">
              该目录不是 Git 仓库
            </div>
          )}
          {status && !status.notRepo && (
            <>
              <div className="git-branch" data-testid="git-branch" title="当前分支">
                <IconBranch size={12} />
                <span>{status.branch || "（无分支）"}</span>
              </div>
              {status.entries.length === 0 && <div className="rs-hint">工作区是干净的，没有未提交的变更。</div>}
              {status.entries.map((en) => (
                <button
                  key={`${en.x}${en.y}:${en.path}`}
                  className={`git-file st-${statusClass(en)}`}
                  data-testid="git-file"
                  onClick={() => void openDiff(en)}
                  title={en.path}
                >
                  <span className="git-st">{statusLetter(en)}</span>
                  <span className="git-path">{en.path}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="rs-section rs-preview">
        <div className="side-heading">预览</div>
        <div className="rs-preview-body" data-testid="file-preview">
          {!diff && <div className="rs-hint">点击变更文件查看 diff。</div>}
          {diff?.untracked && (
            <div className="rs-hint">
              {diff.path}
              <br />
              新文件（未跟踪）
            </div>
          )}
          {diff?.failed && <div className="rs-hint">读取 diff 失败：{diff.failed}</div>}
          {diff?.text != null &&
            (diff.text ? (
              <pre className="rs-diff">
                {diff.text.split(/\r?\n/).map((line, i) => (
                  <span key={i} className={diffLineClass(line)}>
                    {line}
                    {"\n"}
                  </span>
                ))}
              </pre>
            ) : (
              <div className="rs-hint">（无未暂存改动）</div>
            ))}
        </div>
      </div>
    </>
  );
}

/** Diff line tint by prefix — plain prefix check, no full diff highlighting. */
function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-del";
  return "diff-ctx";
}

function MarkdownOrText({ path, text }: { path: string; text: string }) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const isMd = MARKDOWN_EXT.has(ext);
  // Hooks rule: compute unconditionally, render conditionally.
  const html = useMemo(() => (isMd ? renderMarkdown(text) : ""), [isMd, text]);
  if (!isMd) return <pre className="rs-code">{text}</pre>;
  return <div className="rs-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

function TreeNodes({
  nodes,
  depth,
  onOpen,
}: {
  nodes: FsNode[];
  depth: number;
  onOpen: (node: FsNode) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  return (
    <>
      {nodes.map((node) => {
        const isDir = node.type === "dir";
        const isCollapsed = collapsed.has(node.path);
        return (
          <div key={node.path} className="rs-node" style={{ paddingLeft: depth * 14 }}>
            <button
              className="rs-item"
              data-testid="file-item"
              onClick={() => (isDir ? toggle(node.path) : onOpen(node))}
              title={node.path}
            >
              {isDir ? (
                <span className={`rs-chevron ${isCollapsed ? "" : "open"}`}>
                  <IconChevron />
                </span>
              ) : (
                <span className="rs-file-icon">
                  <IconFile />
                </span>
              )}
              <span className="rs-item-name">{node.name}</span>
              {isDir && (
                <span className="rs-dir-icon">
                  <IconFolder />
                </span>
              )}
            </button>
            {isDir && !isCollapsed && node.children && node.children.length > 0 && (
              <TreeNodes nodes={node.children} depth={depth + 1} onOpen={onOpen} />
            )}
          </div>
        );
      })}
    </>
  );
}
