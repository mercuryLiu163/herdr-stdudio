import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useStore, agentForPane, agentDisplayName } from "../store";
import { AnsiView } from "../ansi";
import { parseTranscript, groupTurns, turnStats } from "../chat-parser";
import type { Block, Turn } from "../chat-parser";
import { renderMarkdown, highlightCode } from "../markdown";
import type { PaneLayout, PaneLayoutEntry, PaneRect } from "../types";
import { paneLayout, paneResize, agentPrompt, paneSendText, paneSendKeys, agentSendKeys } from "../api";
import { slashCommandsFor, filterSlashCommands } from "../slash-commands";
import { IconBook, IconClock, IconFile, IconSend, IconTerminal } from "./icons";
import { IconChevron, IconColumns, IconMosaic } from "./icons";

const statusLabel: Record<string, string> = {
  working: "工作中",
  idle: "空闲 · 等待输入",
  blocked: "等待你的确认",
  done: "已完成",
  unknown: "已检测到 agent",
};

function statusColor(s: string | undefined): string {
  if (s === "blocked") return "var(--warn)";
  if (s === "working") return "var(--accent)";
  if (s === "idle") return "var(--ok)";
  if (s === "done") return "var(--info)";
  return "var(--text-faint)";
}

function relativeTime(ts: number): string {
  const d = Math.max(0, Date.now() - ts);
  if (d < 30_000) return "刚刚";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  return `${Math.floor(d / 3_600_000)} 小时前`;
}

type ViewMode = "chat" | "raw";

export function MainPane() {
  const activeTabId = useStore((s) => s.activeTabId);
  const activePaneId = useStore((s) => s.activePaneId);
  const tabs = useStore((s) => s.tabs);
  const panes = useStore((s) => s.panes);
  const agents = useStore((s) => s.agents);
  // NOTE: selectors above return stable references between snapshots, so the
  // main header does NOT re-render on every pane-output tick (V3 F3 perf).
  const tab = useMemo(() => tabs.find((t) => t.tab_id === activeTabId) ?? null, [tabs, activeTabId]);
  const panesOfTab = useMemo(() => panes.filter((p) => p.tab_id === activeTabId), [panes, activeTabId]);
  const pane = useMemo(() => panes.find((p) => p.pane_id === activePaneId) ?? null, [panes, activePaneId]);
  const agent = useMemo(() => agentForPane(agents, activePaneId), [agents, activePaneId]);
  const selectPane = useStore((s) => s.selectPane);
  const status = useStore((s) => s.status);
  const layoutMode = useStore((s) => s.layoutMode);
  const setLayoutMode = useStore((s) => s.setLayoutMode);
  const [view, setView] = useState<ViewMode>("raw");

  // F4: agent panes default to the chat view, shell panes to raw output.
  // Re-apply when the pane changes or when an agent appears/disappears on it.
  const isAgent = !!agent;
  useEffect(() => {
    setView(isAgent ? "chat" : "raw");
  }, [activePaneId, isAgent]);

  if (!tab) {
    return (
      <div className="main">
        <div className="empty">
          <div className="glyph">
            <IconTerminal size={22} />
          </div>
          <h2>选择一个标签</h2>
          <p>从左侧选择工作区和标签，即可查看 agent 的实时输出。</p>
        </div>
      </div>
    );
  }

  const agentLabel = agent ? `${agentDisplayName(agent)} · ${agent.agent}` : "普通终端";

  return (
    <div className="main">
      <div className="main-header">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{tab.label}</h1>
            <div className="sub">
              <span>{agentLabel}</span>
              {agent && (
                <>
                  <span>·</span>
                  <span style={{ color: statusColor(agent.agent_status) }}>
                    {statusLabel[agent.agent_status] ?? agent.agent_status}
                  </span>
                </>
              )}
              {pane?.cwd && (
                <>
                  <span>·</span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {pane.cwd}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="header-segs" style={{ flexShrink: 0 }}>
            <div className="seg" data-testid="layout-mode" title="终端区布局">
              <button
                data-testid="layout-separate"
                aria-pressed={layoutMode === "separate"}
                className={layoutMode === "separate" ? "on" : ""}
                onClick={() => setLayoutMode("separate")}
              >
                <IconColumns /> 分屏
              </button>
              <button
                data-testid="layout-unified"
                aria-pressed={layoutMode === "unified"}
                className={layoutMode === "unified" ? "on" : ""}
                onClick={() => setLayoutMode("unified")}
              >
                <IconMosaic /> 统一
              </button>
            </div>
            {layoutMode === "separate" && (
              <div className="seg">
                <button
                  data-testid="view-chat"
                  aria-pressed={view === "chat"}
                  className={view === "chat" ? "on" : ""}
                  onClick={() => setView("chat")}
                >
                  对话
                </button>
                <button
                  data-testid="view-raw"
                  aria-pressed={view === "raw"}
                  className={view === "raw" ? "on" : ""}
                  onClick={() => setView("raw")}
                >
                  原始输出
                </button>
                <button title="V2 将内嵌 xterm.js 终端" disabled>
                  终端 · V2
                </button>
              </div>
            )}
          </div>
        </div>
        {panesOfTab.length > 0 && (
          <div className="pane-chips">
            {panesOfTab.map((p) => {
              const a = agents.find((x) => x.pane_id === p.pane_id);
              const shortId = p.pane_id.split(":p")[1] ?? "";
              return (
                <button
                  key={p.pane_id}
                  className={`pane-chip ${p.pane_id === activePaneId ? "active" : ""}`}
                  onClick={() => selectPane(p.pane_id)}
                >
                  {a ? (
                    <span className={`sdot ${a.agent_status}`} style={{ width: 7, height: 7 }} />
                  ) : (
                    <IconTerminal size={12} />
                  )}
                  {a ? agentDisplayName(a) : `shell ${shortId}`}
                </button>
              );
            })}
          </div>
        )}
        {status === "reconnecting" && (
          <div className="inline-error" style={{ marginTop: 12 }}>
            与 herdr server 的连接中断，正在重连…
          </div>
        )}
      </div>
      {layoutMode === "unified" ? (
        <Mosaic />
      ) : view === "chat" ? (
        <ChatView />
      ) : (
        <OutputReader />
      )}
      <Composer />
    </div>
  );
}

function OutputReader() {
  const paneId = useStore((s) => s.activePaneId);
  const output = useStore((s) => (s.activePaneId ? s.outputs[s.activePaneId] : undefined));
  const agents = useStore((s) => s.agents);
  const refresh = useStore((s) => s.refreshPaneOutput);
  const status = useStore((s) => s.status);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const agent = agentForPane(agents, paneId);

  // Stick to bottom while streaming, unless the user scrolled up to read.
  useEffect(() => {
    const el = wrapRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [output?.text, paneId]);

  useEffect(() => {
    stick.current = true;
    const el = wrapRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [paneId]);

  if (!paneId) {
    return (
      <div className="empty">
        <div className="glyph">
          <IconBook />
        </div>
        <h2>这个标签里没有窗格</h2>
        <p>在 herdr 里为该标签创建窗格后，这里会显示它的输出。</p>
      </div>
    );
  }

  return (
    <div
      className="reader-wrap"
      ref={wrapRef}
      style={{ position: "relative" }}
      onScroll={(e) => {
        const el = e.currentTarget;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        stick.current = atBottom;
        setShowJump(!atBottom);
      }}
    >
      <div className="reader-card" data-testid="reader-card">
        <ReaderMeta agent={agent} output={output} paneId={paneId} refresh={refresh} />
        {output?.failed ? (
          <div style={{ color: "var(--text-faint)", padding: "8px 0" }}>
            读取输出失败。窗格可能刚刚关闭，或处于 alternate screen（如 vim / htop）。
          </div>
        ) : output?.text ? (
          <AnsiView text={output.text} paneId={paneId} />
        ) : output?.loading || status !== "connected" ? (
          <div style={{ color: "var(--text-faint)", padding: "8px 0" }}>正在读取输出…</div>
        ) : (
          <div style={{ color: "var(--text-faint)", padding: "8px 0" }}>
            暂无输出。向这个窗格发送一条命令或 prompt 试试。
          </div>
        )}
      </div>
      {showJump && (
        <button
          className="jump-pill"
          onClick={() => {
            const el = wrapRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            stick.current = true;
            setShowJump(false);
          }}
        >
          回到底部 ↓
        </button>
      )}
    </div>
  );
}

function ReaderMeta({
  agent,
  output,
  paneId,
  refresh,
}: {
  agent: ReturnType<typeof agentForPane>;
  output?: { updatedAt: number };
  paneId: string;
  refresh: (paneId: string) => Promise<void>;
}) {
  return (
    <div className="reader-meta">
      {agent ? (
        <>
          <span className={`sdot ${agent.agent_status}`} />
          <span>
            {agentDisplayName(agent)} · {statusLabel[agent.agent_status] ?? agent.agent_status}
          </span>
        </>
      ) : (
        <>
          <IconTerminal size={13} />
          <span>终端输出 · recent-unwrapped</span>
        </>
      )}
      <span style={{ marginLeft: "auto" }}>
        {output?.updatedAt ? `更新于 ${relativeTime(output.updatedAt)}` : ""}
      </span>
      <button
        className="hint-key"
        onClick={() => paneId && void refresh(paneId)}
        title="手动刷新"
      >
        刷新
      </button>
    </div>
  );
}

/**
 * V3 F2 immersive chat: the pane transcript rendered as a full-bleed native
 * conversation surface — no `.reader-card` wrapper, no TUI text dump. Markdown
 * for assistant prose (marked + hljs), colored tool chips, inline images via
 * the fs:read data-URL channel, block-level memoized rendering so a streaming
 * update only repaints the changed tail block.
 */
function ChatView() {
  const paneId = useStore((s) => s.activePaneId);
  const output = useStore((s) => (s.activePaneId ? s.outputs[s.activePaneId] : undefined));
  const panes = useStore((s) => s.panes);
  const agents = useStore((s) => s.agents);
  const refresh = useStore((s) => s.refreshPaneOutput);
  const status = useStore((s) => s.status);
  const agent = agentForPane(agents, paneId);
  const cwd = useMemo(
    () => panes.find((p) => p.pane_id === paneId)?.cwd ?? null,
    [panes, paneId],
  );
  // All known cwds: fallback bases when a transcript references an image by a
  // path relative to another pane of the session.
  const cwds = useMemo(() => {
    const out: string[] = [];
    for (const p of panes) {
      const c = (p.cwd ?? "").trim();
      if (c && !out.includes(c)) out.push(c);
    }
    return out;
  }, [panes]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow streaming output while pinned to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [output?.text, paneId]);

  useEffect(() => {
    stick.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [paneId]);

  if (!paneId) {
    return (
      <div className="empty">
        <div className="glyph">
          <IconBook />
        </div>
        <h2>这个标签里没有窗格</h2>
        <p>在 herdr 里为该标签创建窗格后，这里会显示它的输出。</p>
      </div>
    );
  }

  return (
    <div className="chat-immersive" data-testid="chat-immersive">
      <div className="chat-immersive-head">
        <ReaderMeta agent={agent} output={output} paneId={paneId} refresh={refresh} />
      </div>
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {output?.failed && !output?.text ? (
          <div className="chat-thread" data-testid="chat-thread">
            <div className="chat-empty">读取输出失败。窗格可能刚刚关闭，或处于 alternate screen。</div>
          </div>
        ) : output?.text ? (
          <ChatThread text={output.text} cwd={cwd} cwds={cwds} agent={agent} updatedAt={output.updatedAt} />
        ) : output?.loading || status !== "connected" ? (
          <div className="chat-thread" data-testid="chat-thread">
            <div className="chat-empty">正在读取输出…</div>
          </div>
        ) : (
          <div className="chat-thread" data-testid="chat-thread">
            <div className="chat-empty">暂无对话。向这个 agent 发送一条 prompt 试试。</div>
          </div>
        )}
      </div>
    </div>
  );
}

function sameBlock(a: Block, b: Block): boolean {
  return (
    a.type === b.type &&
    a.text === b.text &&
    a.toolName === b.toolName &&
    // review m1: the row summary is now a separate field — a streaming change
    // that only alters it must still repaint the row.
    a.summary === b.summary &&
    a.lang === b.lang &&
    (a.images ?? []).join("\n") === (b.images ?? []).join("\n") &&
    (a.files ?? []).join("\n") === (b.files ?? []).join("\n")
  );
}

function ChatThread({
  text,
  cwd,
  cwds,
  agent,
  updatedAt,
}: {
  text: string;
  cwd: string | null;
  cwds: string[];
  agent: ReturnType<typeof agentForPane>;
  updatedAt: number;
}) {
  const blocks = useMemo(() => parseTranscript(text), [text]);
  const turns = useMemo(() => groupTurns(blocks), [blocks]);
  // Per-turn collapse state (V5 F1): default expanded; the collapsed turn
  // keeps only its header row. Keyed by turn index — turns only ever append
  // while streaming, so indices are stable for existing turns.
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const toggleTurn = (i: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  const clock = hhmmss(updatedAt);
  return (
    <div className="chat-thread" data-testid="chat-thread">
      {turns.length === 0 && <div className="chat-empty">暂无对话内容。</div>}
      {turns.map((turn, ti) => (
        <ChatTurn
          key={ti}
          turn={turn}
          cwd={cwd}
          cwds={cwds}
          agent={agent}
          clock={clock}
          collapsed={collapsed.has(ti)}
          onToggle={() => toggleTurn(ti)}
        />
      ))}
    </div>
  );
}

/** HH:MM:SS of a wall-clock ms timestamp (turn header "最后更新" time). */
function hhmmss(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * One conversation turn (V5 F1): the user prompt, then a header bar with the
 * agent avatar + display name + last-updated clock + derived stat chips
 * (steps / files / duration — only when derivable), then the agent's blocks,
 * then the per-turn modified-files card. The chevron collapses the whole
 * agent-produced section down to the header.
 */
function ChatTurn({
  turn,
  cwd,
  cwds,
  agent,
  clock,
  collapsed,
  onToggle,
}: {
  turn: Turn;
  cwd: string | null;
  cwds: string[];
  agent: ReturnType<typeof agentForPane>;
  clock: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const stats = useMemo(() => turnStats(turn), [turn]);
  const kind = agent?.agent || "agent";
  const name = agent ? agentDisplayName(agent) || kind : "agent";
  const initial = (kind[0] ?? "A").toUpperCase();
  return (
    <section className="chat-turn" data-testid="chat-turn">
      {turn.users.map((b, i) => (
        <ChatBlock key={`u${i}`} block={b} cwd={cwd} cwds={cwds} />
      ))}
      <div className="turn-header" data-testid="turn-header">
        {/* ModelAvatar-style monogram: agent-kind initial + hash hue */}
        <span className="turn-avatar" style={{ background: `hsl(${hashHue(kind)} 58% 46%)` }} aria-hidden>
          {initial}
        </span>
        <span className="turn-agent">{name}</span>
        {/* Pane-level last-activity clock (outputs.updatedAt), NOT a
            per-turn timestamp — labelled so it never reads as "when this
            turn happened". */}
        {clock && (
          <span className="turn-time" title="最后活动：本窗格输出流的最新更新时间">
            最后活动 {clock}
          </span>
        )}
        {stats.steps > 0 && (
          <span className="turn-chip" title="本轮工具调用步数">
            {stats.steps} 步
          </span>
        )}
        {stats.files.length > 0 && (
          <span className="turn-chip" title="本轮涉及的文件数">
            {stats.files.length} 文件
          </span>
        )}
        {stats.duration && (
          <span className="turn-chip" title="本轮耗时">
            <IconClock size={10} /> {stats.duration}
          </span>
        )}
        <button
          className={`turn-collapse ${collapsed ? "" : "open"}`}
          data-testid="turn-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开本轮" : "折叠本轮"}
          title={collapsed ? "展开本轮" : "折叠本轮"}
          onClick={onToggle}
        >
          <IconChevron size={12} />
        </button>
      </div>
      {!collapsed &&
        turn.body.map((b, bi) => <ChatBlock key={`b${bi}`} block={b} cwd={cwd} cwds={cwds} />)}
      {!collapsed && stats.files.length > 0 && <TurnFilesCard files={stats.files} />}
    </section>
  );
}

/**
 * V5 F1 per-turn modified-files card (mcode TurnFilesCard look): folded by
 * default to one summary line, expandable to the deduplicated file rows.
 * Directory rows (trailing "/") keep the V4 info tint.
 */
function TurnFilesCard({ files }: { files: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="turn-files-card" data-testid="turn-files-card">
      <button
        type="button"
        className="tfc-head"
        data-testid="turn-files-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconFile size={13} />
        <span className="tfc-title">本轮修改 {files.length} 个文件</span>
        <span className={`tfc-chevron ${open ? "open" : ""}`}>
          <IconChevron size={11} />
        </span>
      </button>
      {open && (
        <div className="tfc-rows">
          {files.map((f) => (
            <div key={f} className={`turn-file-row${f.endsWith("/") ? " dir" : ""}`} data-testid="turn-file-row" title={f}>
              <span className="tfc-row-icon">
                <IconFile size={11} />
              </span>
              <span className="tfc-row-path">{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One parsed transcript block. memo + content comparator: when a streaming
 * update re-parses the transcript, only blocks whose parsed content actually
 * changed (in practice the tail) re-render.
 */
const ChatBlock = memo(
  function ChatBlock({ block, cwd, cwds }: { block: Block; cwd: string | null; cwds: string[] }) {
    switch (block.type) {
      case "user":
        return (
          <div className="chat-msg user" data-testid="msg-user">
            <div className="chat-bubble">{block.text}</div>
          </div>
        );
      case "assistant":
        return (
          <div className="chat-msg assistant" data-testid="msg-assistant">
            <MarkdownBody text={block.text} />
            {(block.images ?? []).map((img) => (
              <ChatImage key={img} path={img} cwd={cwd} cwds={cwds} />
            ))}
          </div>
        );
      case "tool": {
        // V6 F1 (mcode GenericToolCard look): the tool block is a quiet
        // single-line activity row — 8px hash-hued dot + 12px colored tool
        // name + 13px gray summary + chevron — no border, no banner box. The
        // row shows `summary` (call-form argument); the expanded detail shows
        // the full `text` body under a 2px indent guide (review m1). The
        // `--chip-hue` var is set HERE (not on the chip) so both the dot and
        // the name draw the same hash hue.
        const files = block.files ?? [];
        return (
          <details className="chat-msg tool" data-testid="msg-tool" style={{ "--chip-hue": hashHue(block.toolName ?? "tool") } as CSSProperties}>
            <summary>
              <span className="tool-dot" aria-hidden />
              <span className="tool-chip" data-testid="tool-chip">
                {block.toolName ?? "tool"}
              </span>
              <span className="tool-summary">{block.summary ?? block.text}</span>
              <span className="tool-chevron" aria-hidden>
                <IconChevron size={11} />
              </span>
            </summary>
            {/* V5 F1: the V4 in-block tool-files grid moved up into the
               per-turn turn-files-card; the tool block keeps only its chip
               summary line. The raw body <pre> stays for list-less output. */}
            {files.length === 0 && <pre className="tool-detail">{block.text}</pre>}
            {(block.images ?? []).map((img) => (
              <div className="chat-tool-images" key={img}>
                <ChatImage path={img} cwd={cwd} cwds={cwds} />
              </div>
            ))}
          </details>
        );
      }
      case "code":
        return (
          <pre className="chat-msg code" data-testid="msg-code">
            <CodeBody text={block.text} lang={block.lang} />
          </pre>
        );
      case "thinking":
        /* V4 F1: collapsed thinking row — weakened, expandable, never prose. */
        return (
          <details className="chat-thinking" data-testid="thinking-row">
            <summary>
              <IconClock size={12} />
              <span>思考 {block.text || "…"}</span>
              <span className="thinking-hint hint-collapsed">已折叠 · 点击展开</span>
              <span className="thinking-hint hint-open">点击收起</span>
            </summary>
            <div className="thinking-body">
              思考过程已被 agent 折叠。在终端原始输出里按 ctrl+o 可查看完整原文。
            </div>
          </details>
        );
      case "meta":
        /* V4 F1: meta is a weak separator row — deliberately NOT under the
           `msg-*` namespace so status text never counts as message content. */
        return (
          <div className="chat-meta" data-testid="chat-meta">
            {block.text}
          </div>
        );
      default:
        return null;
    }
  },
  (a, b) => a.cwd === b.cwd && a.cwds === b.cwds && sameBlock(a.block, b.block),
);

/** Markdown → sanitised HTML (escaped source, guarded links, hljs code). */
function MarkdownBody({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text, { stripImages: true }), [text]);
  return <div className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Fenced code with syntax colouring (highlight.js escapes its input). */
function CodeBody({ text, lang }: { text: string; lang?: string }) {
  const html = useMemo(() => highlightCode(text, lang), [text, lang]);
  return <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Deterministic hue per tool name so chips are color-coded consistently. */
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

const isAbsolutePath = (p: string) =>
  /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("/");

function joinPath(base: string, rel: string): string {
  const b = base.replace(/[\\/]+$/, "");
  return /[\\/]$/.test(b) ? b + rel : b + (b.includes("\\") ? "\\" : "/") + rel;
}

/**
 * Inline image for a file path found in assistant/tool text (V3 F2). Paths are
 * resolved against the active pane's cwd (then other known pane cwds, then by
 * basename) and loaded through the existing fs:read data-URL channel — exactly
 * the trust model of the right sidebar preview. Unreadable paths degrade to a
 * faint path label; nothing is fetched from the network.
 */
function ChatImage({ path, cwd, cwds }: { path: string; cwd: string | null; cwds: string[] }) {
  const [resolved, setResolved] = useState<{ src: string; title: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    setFailed(false);
    // Candidates in trust order: exact joined path per known cwd first, then a
    // weak basename-only fallback (may be a different file with the same name).
    const candidates: Array<{ abs: string; fallback: boolean }> = [];
    const push = (abs: string, fallback: boolean) => {
      if (!candidates.some((c) => c.abs === abs)) candidates.push({ abs, fallback });
    };
    if (isAbsolutePath(path)) push(path, false);
    else {
      const bases = [cwd, ...cwds].filter((c): c is string => !!c);
      for (const b of bases) push(joinPath(b, path), false);
      const base = path.split(/[\\/]/).pop() ?? path;
      for (const b of bases) push(joinPath(b, base), true);
    }
    (async () => {
      for (const cand of candidates) {
        try {
          const res = await window.herdr.fsRead(cand.abs);
          if (res?.kind === "image") {
            if (!cancelled) {
              setResolved({
                src: res.data,
                // Review #3: expose what actually resolved; flag the weak
                // basename fallback so misresolved images are identifiable.
                title: (cand.fallback ? "basename 兜底：" : "") + cand.abs,
              });
            }
            return;
          }
        } catch {
          /* try next candidate */
        }
      }
      if (!cancelled) setFailed(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [path, cwd, cwds]);

  if (resolved) {
    return (
      <img
        className="chat-image"
        data-testid="chat-image"
        src={resolved.src}
        alt={path}
        title={resolved.title}
      />
    );
  }
  if (failed) {
    return <span className="chat-image-missing">{path}</span>;
  }
  return null;
}

/**
 * F3 unified layout: every pane of the active tab positioned by the herdr
 * `pane.layout` rect snapshot. V3 F3 performance contract:
 *   (a) cells are `React.memo` components that subscribe to their OWN
 *       `outputs[paneId]` slice — the mosaic never re-renders because one
 *       cell's text changed;
 *   (b) ANSI→HTML goes through the per-pane cache in ansi.tsx (`paneId` prop);
 *   (c) no blind `pane.layout` polling — the snapshot is (re)fetched on mount,
 *       pane-set change, every store snapshot refresh (which `layout.updated`
 *       and other state events trigger), and around drag operations;
 *   (d) dragging previews via local transforms written straight to the DOM;
 *       `pane.resize` is committed only on mouse-up.
 */
function Mosaic() {
  // pane ids joined → stable string selector; identity changes only when the
  // tab's pane set changes (not on output ticks).
  const paneIds = useStore((s) =>
    s.panes
      .filter((p) => p.tab_id === s.activeTabId)
      .map((p) => p.pane_id)
      .join(","),
  );
  const activePaneId = useStore((s) => s.activePaneId);
  const selectPane = useStore((s) => s.selectPane);
  const refreshPaneOutput = useStore((s) => s.refreshPaneOutput);
  const snapshot = useStore((s) => s.snapshot);
  const [layout, setLayout] = useState<PaneLayout | null>(null);
  const layoutRef = useRef<PaneLayout | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const splitterRefs = useRef(new Map<string, HTMLDivElement>());

  const anyPaneId = paneIds ? paneIds.split(",")[0] : null;

  const refetch = useCallback(async () => {
    if (!anyPaneId) {
      layoutRef.current = null;
      setLayout(null);
      setLoadError(null);
      return;
    }
    try {
      const res = await paneLayout(anyPaneId);
      // Mid-drag (once the preview moved) the DOM transform is the truth;
      // applying a fetched layout would fight it. Drag-end refetches anyway.
      if (dragState.current?.moved) return;
      layoutRef.current = res.layout ?? null;
      setLayout(res.layout ?? null);
      setLoadError(null);
    } catch (err: any) {
      if (!dragState.current?.moved) setLoadError(String(err?.message ?? err));
    }
  }, [anyPaneId]);

  // (c) fetch on mount / pane-set change and after every snapshot refresh —
  // herdr `layout.updated` (and pane/tab state events) arrive through
  // scheduleSnapshotRefresh, so this covers all PRD-required triggers.
  useEffect(() => {
    void refetch();
  }, [refetch, snapshot]);

  // Make sure each cell has text to show.
  useEffect(() => {
    for (const id of paneIds.split(",")) if (id) void refreshPaneOutput(id);
  }, [paneIds, refreshPaneOutput]);

  // Default selection = focused pane (the store keeps activePaneId on the
  // focused pane; recover if the tab somehow has no selection).
  useEffect(() => {
    if (!activePaneId && paneIds) selectPane(paneIds.split(",")[0]);
  }, [activePaneId, paneIds, selectPane]);

  const dragState = useRef<{
    splitId: string;
    startX: number;
    startY: number;
    isVertical: boolean;
    movingIds: string[];
    splitterEl: HTMLDivElement | null;
    moved: boolean;
    /** Last CLAMPED displacement — committed on mouse-up (review #2). */
    lastDx: number;
    lastDy: number;
  } | null>(null);
  // nit: detach the window listeners if we unmount mid-drag.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    },
    [],
  );

  /** Clamp the preview shift so the divider stays within the mosaic area. */
  const clampPreview = (d: number, split: NonNullable<PaneLayout["splits"]>[number], area: PaneRect) => {
    const wrap = wrapRef.current;
    if (!wrap) return d;
    const box = wrap.getBoundingClientRect();
    if (dragState.current?.isVertical) {
      const dividerPx = ((split.rect.x - area.x + split.rect.width * split.ratio) / area.width) * box.width;
      const min = box.width * 0.08 - dividerPx;
      const max = box.width * 0.92 - dividerPx;
      return Math.min(max, Math.max(min, d));
    }
    const dividerPx = ((split.rect.y - area.y + split.rect.height * split.ratio) / area.height) * box.height;
    const min = box.height * 0.08 - dividerPx;
    const max = box.height * 0.92 - dividerPx;
    return Math.min(max, Math.max(min, d));
  };

  const beginDrag = (split: NonNullable<PaneLayout["splits"]>[number]) => (e: ReactMouseEvent) => {
    e.preventDefault();
    const lay = layoutRef.current;
    if (!lay || !lay.area) return;
    // (c) pull a fresh snapshot around the drag window (before the preview moves).
    void refetch();
    const isVertical = split.direction === "right"; // vertical divider between left|right
    const movingIds = lay.panes
      .filter((p) =>
        isVertical
          ? p.rect.x >= split.rect.x + split.rect.width - 1
          : p.rect.y >= split.rect.y + split.rect.height - 1,
      )
      .map((p) => p.pane_id);
    dragState.current = {
      splitId: split.id,
      startX: e.clientX,
      startY: e.clientY,
      isVertical,
      movingIds,
      splitterEl: splitterRefs.current.get(split.id) ?? null,
      moved: false,
      lastDx: 0,
      lastDy: 0,
    };
    document.body.classList.add("mosaic-dragging");

    // (d) live preview: write transforms straight to the DOM — no React
    // re-render, no layout RPC per mousemove.
    const onMove = (ev: MouseEvent) => {
      const st = dragState.current;
      if (!st || !lay.area) return;
      const raw = st.isVertical ? ev.clientX - st.startX : ev.clientY - st.startY;
      const d = clampPreview(raw, split, lay.area);
      if (Math.abs(d) > 2) st.moved = true;
      // Record the clamped value: this is what the preview shows AND what the
      // commit submits on release.
      if (st.isVertical) {
        st.lastDx = d;
        st.lastDy = 0;
      } else {
        st.lastDx = 0;
        st.lastDy = d;
      }
      const t = st.isVertical ? `translate3d(${d}px,0,0)` : `translate3d(0,${d}px,0)`;
      for (const id of st.movingIds) cellRefs.current.get(id)?.style.setProperty("transform", t);
      st.splitterEl?.style.setProperty("transform", t);
    };

    const onUp = () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      const st = dragState.current;
      dragState.current = null;
      document.body.classList.remove("mosaic-dragging");
      if (!st) return;
      // Clear the local preview; the committed layout takes over.
      for (const id of st.movingIds) cellRefs.current.get(id)?.style.removeProperty("transform");
      st.splitterEl?.style.removeProperty("transform");
      // Commit the CLAMPED preview displacement, not the raw mouse travel.
      void commitResize(st.splitId, st.isVertical ? "right" : "down", st.lastDx, st.lastDy);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    dragCleanupRef.current = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("mosaic-dragging");
    };
  };

  const commitResize = async (splitId: string, direction: string, dx: number, dy: number) => {
    const lay = layoutRef.current;
    const split = lay?.splits?.find((s) => s.id === splitId);
    if (!split || !lay) return;
    const isVertical = direction === "right"; // vertical divider between left|right
    const deltaPx = isVertical ? dx : dy;
    if (Math.abs(deltaPx) < 4) {
      // Below threshold: re-sync (drag-end is a PRD fetch trigger anyway).
      void refetch();
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) return;
    const box = wrap.getBoundingClientRect();
    const totalPx = isVertical ? box.width : box.height;
    const amount = Math.min(0.9, Math.abs(deltaPx / totalPx));
    const dir = isVertical ? (deltaPx > 0 ? "right" : "left") : deltaPx > 0 ? "down" : "up";
    // Any pane inside the split's rect identifies the split to herdr.
    const paneInSplit = lay.panes.find(
      (p) =>
        p.rect.x >= split.rect.x &&
        p.rect.y >= split.rect.y &&
        p.rect.x + p.rect.width <= split.rect.x + split.rect.width + 1 &&
        p.rect.y + p.rect.height <= split.rect.y + split.rect.height + 1,
    );
    if (!paneInSplit) return;
    try {
      const res = await paneResize(paneInSplit.pane_id, dir, amount);
      const next = res?.resize?.layout;
      if (next) {
        layoutRef.current = next;
        setLayout(next);
      } else {
        void refetch(); // (c) drag-end refetch
      }
    } catch {
      /* resize refused — the drag-end refetch refreshes the snapshot anyway */
      void refetch();
    }
  };

  const onSelectCell = useCallback((id: string) => selectPane(id), [selectPane]);

  // Stable identities so the memoized cells only re-render for real prop changes.
  const registerCellRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(id, el);
    else cellRefs.current.delete(id);
  }, []);

  const entries: PaneLayoutEntry[] = layout?.panes ?? [];
  const area: PaneRect | undefined = layout?.area;

  return (
    <div className="mosaic-wrap">
      <div className="mosaic" data-testid="mosaic" ref={wrapRef}>
        {!layout && !loadError && <div className="rs-hint">正在读取布局…</div>}
        {loadError && <div className="rs-hint">读取布局失败：{loadError}</div>}
        {layout &&
          area &&
          entries.map((entry) => (
            <MosaicCell
              key={entry.pane_id}
              paneId={entry.pane_id}
              rect={entry.rect}
              area={area}
              selected={entry.pane_id === activePaneId}
              onSelect={onSelectCell}
              registerRef={registerCellRef}
            />
          ))}
        {layout &&
          area &&
          (layout.splits ?? []).map((split) => {
            const isVertical = split.direction === "right";
            const style: CSSProperties = isVertical
              ? {
                  left: `calc(${pct(split.rect.x - area.x + split.rect.width * split.ratio, area.width)} - 5px)`,
                  top: pct(split.rect.y - area.y, area.height),
                  width: 10,
                  height: pct(split.rect.height, area.height),
                }
              : {
                  left: pct(split.rect.x - area.x, area.width),
                  top: `calc(${pct(split.rect.y - area.y + split.rect.height * split.ratio, area.height)} - 5px)`,
                  width: pct(split.rect.width, area.width),
                  height: 10,
                };
            return (
              <div
                key={split.id}
                className={`splitter ${isVertical ? "v" : "h"}`}
                data-testid={`splitter-${split.id}`}
                style={style}
                onMouseDown={beginDrag(split)}
                ref={(el) => {
                  if (el) splitterRefs.current.set(split.id, el);
                  else splitterRefs.current.delete(split.id);
                }}
                title="拖动调整布局"
              />
            );
          })}
      </div>
    </div>
  );
}

function pct(v: number, total: number) {
  return `${(v / total) * 100}%`;
}

/**
 * One mosaic cell. Memo + per-cell store subscriptions: a text update on pane X
 * only re-renders pane X's cell (the parent never subscribes to `outputs`).
 */
const MosaicCell = memo(function MosaicCell({
  paneId,
  rect,
  area,
  selected,
  onSelect,
  registerRef,
}: {
  paneId: string;
  rect: PaneRect;
  area: PaneRect;
  selected: boolean;
  onSelect: (paneId: string) => void;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const output = useStore((s) => s.outputs[paneId]); // (a) own slice only
  const agent = useStore((s) => s.agents.find((a) => a.pane_id === paneId));
  const shortId = paneId.split(":p")[1] ?? "";
  const style = useMemo<CSSProperties>(
    () => ({
      left: pct(rect.x - area.x, area.width),
      top: pct(rect.y - area.y, area.height),
      width: pct(rect.width, area.width),
      height: pct(rect.height, area.height),
    }),
    [rect.x, rect.y, rect.width, rect.height, area.x, area.y, area.width, area.height],
  );
  return (
    <div
      ref={(el) => registerRef(paneId, el)}
      className={`mosaic-cell${selected ? " mosaic-pane-selected" : ""}`}
      data-testid={`mosaic-pane-${paneId}`}
      data-selected={selected ? "true" : "false"}
      style={style}
      onClick={() => onSelect(paneId)}
      title={selected ? "输入目标（点击切换）" : "点击设为输入目标"}
    >
      <div className="mosaic-cell-head">
        {agent ? (
          <span className={`sdot ${agent.agent_status}`} />
        ) : (
          <IconTerminal size={11} />
        )}
        <span>{agent ? agentDisplayName(agent) : `shell ${shortId}`}</span>
      </div>
      <div className="mosaic-cell-body">
        {output?.text ? (
          <AnsiView text={output.text} paneId={paneId} />
        ) : (
          <div className="rs-hint" style={{ padding: "6px 10px" }}>
            {output?.loading ? "正在读取输出…" : "暂无输出"}
          </div>
        )}
      </div>
    </div>
  );
});

function Composer() {
  const layoutMode = useStore((s) => s.layoutMode);
  const paneId = useStore((s) => s.activePaneId);
  const panes = useStore((s) => s.panes);
  const agents = useStore((s) => s.agents);
  const activeTabId = useStore((s) => s.activeTabId);
  const selectPane = useStore((s) => s.selectPane);
  const pane = useStore((s) => s.panes.find((p) => p.pane_id === s.activePaneId) ?? null);
  const agent = useStore((s) => agentForPane(s.agents, s.activePaneId));
  const status = useStore((s) => s.status);
  const pushToast = useStore((s) => s.pushToast);
  const refreshPane = useStore((s) => s.refreshPaneOutput);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // V4 F2 slash palette: open only while typing a single-line "/query" on an
  // agent pane; explicit state (not derived) so selecting a command and
  // keeping the text in the input does not re-open the palette.
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);

  const slashItems = useMemo(() => {
    if (!agent || !slashOpen) return [];
    if (!/^\/[^\n\s]*$/.test(text)) return []; // multi-line or args started
    return filterSlashCommands(slashCommandsFor(agent.agent), text);
  }, [agent, slashOpen, text]);
  const paletteOpen = slashItems.length > 0;
  const hlIdx = Math.min(slashIdx, Math.max(0, slashItems.length - 1));

  const chooseSlash = (i: number) => {
    const item = slashItems[i];
    if (!item) return;
    setText(item.cmd);
    setSlashOpen(false);
    taRef.current?.focus();
  };

  // F3 input-target dropdown options (unified mode only). `paneId` doubles as
  // the selected target so the dropdown and cell clicks stay in sync.
  const targetOptions = useMemo(() => {
    if (layoutMode !== "unified") return [];
    return panes
      .filter((p) => p.tab_id === activeTabId)
      .map((p) => {
        const a = agents.find((x) => x.pane_id === p.pane_id);
        const shortId = p.pane_id.split(":p")[1] ?? "";
        return { paneId: p.pane_id, label: a ? agentDisplayName(a) : `shell ${shortId}` };
      });
  }, [layoutMode, panes, agents, activeTabId]);

  const canSend = paneId !== null && text.trim().length > 0 && !sending && status !== "no-server";

  const send = async () => {
    if (!canSend || !paneId) return;
    setSending(true);
    setError(null);
    try {
      if (agent) {
        // agent.* accepts the hosting pane id as target; more reliable than the
        // display name, which detected agents often don't have.
        try {
          await agentPrompt(agent.pane_id, text.trim());
        } catch (err: any) {
          // herdr only rejects agent.prompt with this exact condition for
          // detected/reported agents that are not active NAMED agents; only
          // that case falls back to typing into the pane. Timeouts and other
          // errors must surface (rethrow) — a blind fallback could re-deliver
          // the prompt after a slow-but-successful attempt and mask failures.
          if (!/not an active named agent/i.test(String(err?.message ?? err))) throw err;
          // Fall back to the plain-text TUI channel every agent accepts
          // (V4 F2 slash commands rely on it).
          await paneSendText(paneId, text.trim());
        }
      } else {
        await paneSendText(paneId, text);
      }
      setText("");
      setTimeout(() => void refreshPane(paneId), 300);
    } catch (err: any) {
      setError(err?.message ?? "发送失败");
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  };

  const interrupt = async (keys: string[]) => {
    if (!paneId) return;
    try {
      if (agent) await agentSendKeys(agent.pane_id, keys);
      else await paneSendKeys(paneId, keys);
      pushToast("info", `已发送 ${keys.join(" ")}`);
      setTimeout(() => void refreshPane(paneId), 300);
    } catch (err: any) {
      pushToast("error", `发送按键失败：${err?.message ?? ""}`);
    }
  };

  return (
    <div className="composer-wrap">
      {error && <div className="inline-error">{error}</div>}
      <div className="composer">
        {paletteOpen && (
          <div className="slash-palette" data-testid="slash-palette">
            {slashItems.map((c, i) => (
              <button
                type="button"
                key={c.cmd}
                className={`slash-item${i === hlIdx ? " active" : ""}`}
                data-testid="slash-item"
                // keep textarea focus on click (mousedown would blur it)
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chooseSlash(i)}
                onMouseEnter={() => setSlashIdx(i)}
              >
                <span className="slash-cmd">{c.cmd}</span>
                <span className="slash-desc">{c.desc}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={text}
          placeholder={
            agent
              ? `向 ${agentDisplayName(agent)} 发送任务…（Enter 发送，Shift+Enter 换行）`
              : pane
                ? "输入 shell 命令…（Enter 执行）"
                : "先选择一个窗格"
          }
          disabled={!paneId || status === "no-server"}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            setSlashIdx(0);
            // open only for a fresh single-line "/" query on an agent pane
            setSlashOpen(!!agent && v.startsWith("/") && !/\s/.test(v));
          }}
          onBlur={() => setSlashOpen(false)}
          onKeyDown={(e) => {
            // Palette open: navigation / selection is consumed here and never
            // reaches the send path.
            if (paletteOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIdx((hlIdx + 1) % slashItems.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIdx((hlIdx - 1 + slashItems.length) % slashItems.length);
                return;
              }
              if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey)) {
                // select = backfill the input; sending needs a second Enter
                e.preventDefault();
                chooseSlash(hlIdx);
                return;
              }
              if (e.key === "Escape") {
                setSlashOpen(false);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
        />
        <div className="composer-row">
          {layoutMode === "unified" && targetOptions.length > 0 && (
            <select
              className="composer-target"
              data-testid="input-target"
              value={paneId ?? ""}
              onChange={(e) => selectPane(e.target.value)}
              disabled={!paneId || status === "no-server"}
              title="输入发送到哪个窗格"
            >
              {targetOptions.map((o) => (
                <option key={o.paneId} value={o.paneId}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <button className="hint-key" onClick={() => void interrupt(["esc"])} disabled={!paneId}>
            Esc 中断
          </button>
          <button className="hint-key" onClick={() => void interrupt(["ctrl+c"])} disabled={!paneId}>
            Ctrl+C
          </button>
          <button className="send-btn" onClick={() => void send()} disabled={!canSend}>
            <IconSend />
            {agent ? "发送 prompt" : "执行"}
          </button>
        </div>
      </div>
    </div>
  );
}
