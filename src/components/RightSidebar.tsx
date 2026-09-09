import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { useStore } from "../store";
import type { FsNode, FilePreview } from "../types";
import { IconChevron, IconFile, IconFolder, IconOpenExternal } from "./icons";

/**
 * F2 right tool sidebar (ChatGPT Desktop style):
 *   - cwd quick-switcher over the workspaces' known pane cwds
 *   - project file tree rooted at the active pane's cwd (depth 3)
 *   - preview: markdown → HTML (marked, raw HTML escaped), images inline,
 *     text in <pre>, anything else opens externally
 */

const TREE_DEPTH = 3;
const MARKDOWN_EXT = new Set([".md", ".markdown"]);

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

export function RightSidebar() {
  const panes = useStore((s) => s.panes);
  const activePaneId = useStore((s) => s.activePaneId);
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

  const [manualRoot, setManualRoot] = useState<string | null>(null);
  const root = manualRoot ?? activeCwd;

  // Following the active pane wins over a stale manual choice.
  useEffect(() => {
    setManualRoot(null);
  }, [activeCwd]);

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
          onChange={(e) => setManualRoot(e.target.value)}
        >
          {cwds.length === 0 && <option value="">（无已知目录）</option>}
          {cwds.map((cwd) => (
            <option key={cwd} value={cwd}>
              {cwd}
            </option>
          ))}
        </select>
      </div>

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
          {preview && preview.kind === "text" && (
            <MarkdownOrText path={preview.path} text={preview.data} />
          )}
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
    </div>
  );
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
