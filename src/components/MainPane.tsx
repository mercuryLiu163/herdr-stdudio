import { memo, useCallback, useEffect, useMemo, useRef, useState, useReducer } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useStore, agentForPane, agentDisplayName } from "../store";
import { AnsiView } from "../ansi";
import {
  parseTranscript,
  groupTurns,
  turnStats,
  looksLikeChat,
  extractComposerStatus,
  formatDurationSeconds,
  IMAGE_EXT_RE,
} from "../chat-parser";
import type { Block, Turn } from "../chat-parser";
import { renderMarkdown, highlightCode } from "../markdown";
import type { PaneLayout, PaneLayoutEntry, PaneRect } from "../types";
import { paneLayout, paneResize, agentPrompt, paneSendText, paneSendKeys, agentSendKeys, paneType } from "../api";
import { slashCommandsFor, filterSlashCommands } from "../slash-commands";
import { IconBook, IconClock, IconFile, IconGrid, IconPaperclip, IconPlus, IconStop, IconTerminal, IconUserMsg } from "./icons";
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

/** Isolated so MainPane's header does not re-render on every output tick. */
function AutoChatView({
  paneId,
  isAgent,
  onAuto,
}: {
  paneId: string | null;
  isAgent: boolean;
  onAuto: (view: ViewMode) => void;
}) {
  const text = useStore((s) => (paneId ? s.outputs[paneId]?.text : undefined));
  useEffect(() => {
    onAuto(isAgent || looksLikeChat(text ?? "") ? "chat" : "raw");
  }, [paneId, isAgent, text, onAuto]);
  return null;
}

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
  const [view, setView] = useState<ViewMode>("chat");
  const viewPicked = useRef<ViewMode | null>(null);

  // Agent panes, and shells whose transcript is actually a conversation
  // (ZCODE etc. — herdr may not have classified them as agents), open in
  // the chat view. The user can still flip to 原始输出; a pane change
  // clears that override.
  const isAgent = !!agent;
  useEffect(() => {
    viewPicked.current = null;
  }, [activePaneId]);
  const applyAutoView = useCallback((next: ViewMode) => {
    if (viewPicked.current) return;
    setView(next);
  }, []);
  const pickView = (next: ViewMode) => {
    viewPicked.current = next;
    setView(next);
  };

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
      <AutoChatView paneId={activePaneId} isAgent={isAgent} onAuto={applyAutoView} />
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
                  onClick={() => pickView("chat")}
                >
                  对话
                </button>
                <button
                  data-testid="view-raw"
                  aria-pressed={view === "raw"}
                  className={view === "raw" ? "on" : ""}
                  onClick={() => pickView("raw")}
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
        <OutputReader onSwitchToChat={() => pickView("chat")} />
      )}
      <Composer view={view} onPickView={pickView} />
    </div>
  );
}

function OutputReader({ onSwitchToChat }: { onSwitchToChat?: () => void }) {
  const paneId = useStore((s) => s.activePaneId);
  const output = useStore((s) => (s.activePaneId ? s.outputs[s.activePaneId] : undefined));
  const asChat = looksLikeChat(output?.text ?? "");
  const agents = useStore((s) => s.agents);
  const refresh = useStore((s) => s.refreshPaneOutput);
  const status = useStore((s) => s.status);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const agent = agentForPane(agents, paneId);

  // Stick to bottom while streaming, unless the user scrolled up to read.
  // F7.3: the pin is scheduled on the next animation frame — the text tick
  // itself never reads scrollHeight synchronously (no layout thrash while
  // tokens stream).
  const stickRaf = useRef(0);
  useEffect(() => {
    if (!stick.current) return;
    cancelAnimationFrame(stickRaf.current);
    stickRaf.current = requestAnimationFrame(() => {
      const el = wrapRef.current;
      if (el && stick.current) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(stickRaf.current);
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
        {asChat && onSwitchToChat && (
          <button
            type="button"
            className="switch-to-chat"
            data-testid="switch-to-chat"
            onClick={onSwitchToChat}
          >
            这段是对话转写，点此切换到「对话」视图重排
          </button>
        )}
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

  // Follow streaming output while pinned to the bottom (F7.3: rAF-scheduled —
  // the text tick never reads layout synchronously).
  const stickRaf = useRef(0);
  useEffect(() => {
    if (!stick.current) return;
    cancelAnimationFrame(stickRaf.current);
    stickRaf.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el && stick.current) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(stickRaf.current);
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
          <ChatThread
            text={output.text}
            cwd={cwd}
            cwds={cwds}
            agent={agent}
            updatedAt={output.updatedAt}
            working={agent?.agent_status === "working"}
          />
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
  working,
}: {
  text: string;
  cwd: string | null;
  cwds: string[];
  agent: ReturnType<typeof agentForPane>;
  updatedAt: number;
  working: boolean;
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
          updatedAt={updatedAt}
          working={working && ti === turns.length - 1}
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
 * F7.2 the isolated seconds clock. The turn-header time is its OWN component
 * with a private 1s interval + local state, memo-isolated from the streaming
 * text: a pane output tick re-renders ChatThread/ChatTurn but this component
 * (and therefore its DOM node) is untouched unless `updatedAt` itself moved
 * across a second. This is what keeps the clock's DOM identity stable while
 * tokens stream.
 */
const Elapsed = memo(
  function Elapsed({ updatedAt }: { updatedAt: number }) {
    // Private 1s heartbeat: keeps the clock self-driven so it never depends
    // on (nor contributes to) the parent's streaming re-render cycle.
    const [, setHeartbeat] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      const t = window.setInterval(() => setHeartbeat(), 1000);
      return () => window.clearInterval(t);
    }, []);
    return <>{hhmmss(updatedAt)}</>;
  },
  (a, b) => hhmmss(a.updatedAt) === hhmmss(b.updatedAt),
);

/**
 * F6 the live thinking row. While the agent is working, every thinking block
 * of the turn merges into THIS single row (spinner = pure CSS transform
 * keyframes, never JS-driven) + "思考中 Ns"; when the turn ends the row is
 * replaced by the frozen per-block 思考 rows again.
 */
function ThinkingLive({ blocks }: { blocks: Block[] }) {
  const total = blocks.reduce((sum, b) => {
    const m = b.text.match(/([\d.]+)\s*s/i);
    return m ? sum + parseFloat(m[1]) : sum;
  }, 0);
  return (
    <div className="chat-thinking live" data-testid="thinking-live" title="Agent 正在思考 — 流式思考已实时合并">
      <span className="thinking-spinner" data-testid="thinking-spinner" aria-hidden />
      <span className="thinking-live-label">
        思考中{total > 0 ? ` ${formatDurationSeconds(total)}` : "…"}
      </span>
    </div>
  );
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
  updatedAt,
  working,
  collapsed,
  onToggle,
}: {
  turn: Turn;
  cwd: string | null;
  cwds: string[];
  agent: ReturnType<typeof agentForPane>;
  updatedAt: number;
  working: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const stats = useMemo(() => turnStats(turn), [turn]);
  const kind = agent?.agent || "agent";
  const name = agent ? agentDisplayName(agent) || kind : "agent";
  const initial = (kind[0] ?? "A").toUpperCase();
  const hasBody = turn.body.length > 0 || stats.files.length > 0;
  // F6: while the agent is working, thinking blocks of the ONGOING (latest,
  // non-terminated) turn merge into ONE live row rendered at the LAST thinking
  // position; the individual blocks disappear (思考内容 never unfolds line by
  // line while streaming). ChatThread only marks the LAST turn as working —
  // history never revives the spinner. A turn that already carries its
  // duration meta ("Worked for 28s") has ENDED — its thinking is settled
  // history and stays a frozen collapsible 思考 row (V4 F1 contract).
  const turnLive = working && stats.duration === null;
  const bodyBlocks: Array<{ block: Block | null; live: Block[] | null }> = [];
  if (turnLive) {
    const thinkIdx: number[] = [];
    turn.body.forEach((b, i) => {
      if (b.type === "thinking") thinkIdx.push(i);
    });
    const lastThink = thinkIdx.length ? thinkIdx[thinkIdx.length - 1] : -1;
    turn.body.forEach((b, i) => {
      if (b.type === "thinking") {
        if (i === lastThink) bodyBlocks.push({ block: null, live: thinkIdx.map((j) => turn.body[j]) });
        else bodyBlocks.push({ block: null, live: null });
      } else {
        bodyBlocks.push({ block: b, live: null });
      }
    });
  } else {
    for (const b of turn.body) bodyBlocks.push({ block: b, live: null });
  }
  return (
    <section className="chat-turn" data-testid="chat-turn">
      {turn.users.map((b, i) => (
        <ChatBlock key={`u${i}`} block={b} cwd={cwd} cwds={cwds} />
      ))}
      {hasBody && (
      <div className="turn-header" data-testid="turn-header">
        <span className="turn-rule" aria-hidden />
        <div className="turn-pill" data-testid="turn-pill">
          <button
            className={`turn-collapse ${collapsed ? "" : "open"}`}
            data-testid="turn-collapse"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "展开本轮" : "折叠本轮"}
            title={collapsed ? "展开本轮" : "折叠本轮"}
            onClick={onToggle}
          >
            <IconChevron size={11} />
          </button>
          <span className="turn-avatar" style={{ background: `hsl(${hashHue(kind)} 58% 46%)` }} aria-hidden>
            {initial}
          </span>
          <span className="turn-agent">{name}</span>
          {!!updatedAt && (
            <span className="turn-time" title="最后活动：本窗格输出流的最新更新时间">
              <Elapsed updatedAt={updatedAt} />
            </span>
          )}
          {stats.duration && (
            <>
              <span className="turn-dot" aria-hidden>
                ·
              </span>
              <span className="turn-chip" title="本轮耗时">
                {stats.duration}
              </span>
            </>
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
        </div>
      </div>
      )}
      {!collapsed &&
        bodyBlocks.map((entry, bi) =>
          entry.live ? (
            <ThinkingLive key={`live${bi}`} blocks={entry.live} />
          ) : entry.block ? (
            <ChatBlock key={`b${bi}`} block={entry.block} cwd={cwd} cwds={cwds} />
          ) : null,
        )}
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
        return <UserCard text={block.text} />;
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

/**
 * V7 F1: user prompt re-laid out as a right-aligned card. A single short
 * line stays a quiet bubble; a multiline / markdown prompt becomes a
 * collapsible title + markdown body (mcode ChatPane user card).
 */
function UserCard({ text }: { text: string }) {
  const lines = text.replace(/\s+$/, "").split("\n");
  const title = (lines[0] ?? "").trim();
  const rich = lines.length > 1;
  const [open, setOpen] = useState(true);
  return (
    <div className="chat-msg user" data-testid="msg-user">
      <div className={`chat-bubble${rich ? " user-card" : ""}`}>
        {rich ? (
          <>
            <button
              type="button"
              className={`user-card-head${open ? " open" : ""}`}
              data-testid="user-card-toggle"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="user-card-icon" aria-hidden>
                <IconUserMsg size={12} />
              </span>
              <span className="user-card-title">{title}</span>
              <span className="user-card-chevron" aria-hidden>
                <IconChevron size={11} />
              </span>
            </button>
            {open && (
              <div className="user-card-body">
                <MarkdownBody text={text} />
              </div>
            )}
          </>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

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

type Attachment = { id: string; path: string; name: string; preview: string };

function atRef(p: string): string {
  return /\s/.test(p) ? `@"${p}"` : `@${p}`;
}

const EFFORT_OPTIONS = [
  { id: "low", label: "Low", cmd: "/effort low" },
  { id: "medium", label: "Medium", cmd: "/effort medium" },
  { id: "high", label: "High", cmd: "/effort high" },
  { id: "xhigh", label: "xHigh", cmd: "/effort xhigh" },
] as const;

/**
 * F5 model presets per agent kind (segment 模型 ∨). Each entry is sent
 * verbatim as `/model <id>` through the V4 slash channel — the label shown in
 * the menu ends with the id so what the user reads is exactly what is sent.
 * Unknown kinds fall back to a single honest entry (no invented models).
 */
const MODEL_PRESETS: Record<string, string[]> = {
  claude: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  codex: ["gpt-5.2", "gpt-5.2-codex", "gpt-5.2-mini"],
  grok: ["grok-4.6", "grok-4.6-fast", "grok-4.6-mini"],
  gemini: ["gemini-3-pro", "gemini-3-flash"],
};

function modelPresetsFor(kind: string | null | undefined): string[] {
  const k = (kind ?? "").toLowerCase();
  for (const key of Object.keys(MODEL_PRESETS)) {
    if (k.includes(key)) return MODEL_PRESETS[key];
  }
  return ["default"];
}

/** Short status word for the F5 toolbar status ring (the long form lives in the header). */
const STATUS_WORD: Record<string, string> = {
  working: "工作中",
  idle: "空闲",
  blocked: "待确认",
  done: "完成",
  unknown: "已接入",
};

type ModeId = "ask" | "auto" | "plan" | "bypass";

const MODE_OPTIONS: Array<{ id: ModeId; label: string; cmd: string; hint: string; tone: string }> = [
  { id: "ask", label: "Ask", cmd: "", hint: "每次询问权限", tone: "dim" },
  { id: "auto", label: "Auto", cmd: "/auto", hint: "安全操作自动批准", tone: "ok" },
  { id: "plan", label: "Plan", cmd: "/plan", hint: "计划模式", tone: "info" },
  { id: "bypass", label: "Bypass", cmd: "/always-approve", hint: "/always-approve", tone: "danger" },
];

function effortLabel(effort?: string): string {
  if (!effort) return "";
  const hit = EFFORT_OPTIONS.find((e) => e.id === effort.toLowerCase());
  return hit?.label ?? effort;
}

function modeIdOf(mode?: string): ModeId {
  const m = (mode ?? "").toLowerCase();
  if (/always-approve|yolo|bypass/.test(m)) return "bypass";
  if (/plan/.test(m)) return "plan";
  if (/^auto$|auto-edit/.test(m)) return "auto";
  return "ask";
}

function isSlashCommand(text: string): boolean {
  const t = text.trim();
  return /^\/[a-z][\w-]*(?:\s+\S+)*$/i.test(t) && !t.includes("\n");
}

async function sendTuiSlash(paneId: string, cmd: string): Promise<void> {
  const raw = cmd.trim();
  const m = raw.match(/^\/([A-Za-z][\w-]*)([\s\S]*)$/);
  if (!m) {
    await paneType(paneId, raw, ["enter"]);
    return;
  }
  // Type `/` first so Grok/Claude open the slash palette, then the rest + Enter
  // to run it as a TUI command — never as an agent user-turn.
  await paneType(paneId, "/");
  await new Promise((r) => setTimeout(r, 50));
  await paneType(paneId, `${m[1]}${m[2]}`, ["enter"]);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXT_RE.test(file.name);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

// 复审收敛（V9 再收敛）：工具条 = 离散按钮组。共享浮层只剩一种（toolbar-menu），
// 内容随 openMenu 切换：tb-attach = 引用文件列表；tb-model = 模型预设 + 推理
// 力度 + 权限模式 两组（原 effort/mode 独立段并入此处，testid 保留在组容器上）。
type ToolbarMenuId = "tb-attach" | "tb-model";

function Composer({ view, onPickView }: { view: ViewMode; onPickView: (v: ViewMode) => void }) {
  const layoutMode = useStore((s) => s.layoutMode);
  const paneId = useStore((s) => s.activePaneId);
  const panes = useStore((s) => s.panes);
  const agents = useStore((s) => s.agents);
  const activeTabId = useStore((s) => s.activeTabId);
  const selectPane = useStore((s) => s.selectPane);
  const pane = useStore((s) => s.panes.find((p) => p.pane_id === s.activePaneId) ?? null);
  const agent = useStore((s) => agentForPane(s.agents, s.activePaneId));
  const outputText = useStore((s) => (s.activePaneId ? s.outputs[s.activePaneId]?.text : undefined));
  const status = useStore((s) => s.status);
  const pushToast = useStore((s) => s.pushToast);
  const refreshPane = useStore((s) => s.refreshPaneOutput);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sessionBar = useMemo(() => extractComposerStatus(outputText ?? ""), [outputText]);
  // V4 F2 slash palette: open only while typing a single-line "/query" on an
  // agent pane; explicit state (not derived) so selecting a command and
  // keeping the text in the input does not re-open the palette. V9 adds the
  // button form (tools-button): same palette, opened without typing "/".
  const [slashOpen, setSlashOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  // V9: one shared popup for the whole toolbar row. "tb-attach" = file
  // reference list, "tb-model" = model presets + effort/mode groups. The
  // panel is ALWAYS mounted on agent panes (ghost when closed) so the V8
  // composer-effort / composer-mode contracts keep resolving; see the render.
  const [openMenu, setOpenMenu] = useState<null | ToolbarMenuId>(null);
  /** Keyboard highlight within the open tb menu (m3 review). */
  const [tbIdx, setTbIdx] = useState(0);
  const [modeOver, setModeOver] = useState<ModeId | null>(null);
  const [effortOver, setEffortOver] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // F5 引用文件: first-level file entries of the tab's pane cwds, loaded when
  // the attach popup opens.
  const [tbFiles, setTbFiles] = useState<Array<{ name: string; path: string }>>([]);

  const slashItems = useMemo(() => {
    if (!agent || (!slashOpen && !toolsOpen)) return [];
    // Button form (tools-button): show the full list even with an empty input.
    const query = /^\/[^\n\s]*$/.test(text) ? text : "/";
    return filterSlashCommands(slashCommandsFor(agent.agent), query);
  }, [agent, slashOpen, toolsOpen, text]);
  const paletteOpen = slashItems.length > 0;
  const hlIdx = Math.min(slashIdx, Math.max(0, slashItems.length - 1));

  const chooseSlash = (i: number) => {
    const item = slashItems[i];
    if (!item) return;
    setText(item.cmd);
    setSlashOpen(false);
    setToolsOpen(false);
    taRef.current?.focus();
  };

  /**
   * F5 引用文件/attach: insert at the textarea cursor, not the tail — the
   * caret position survives through selectionStart/End and is restored after
   * the controlled state update.
   */
  const insertAtCursor = useCallback(
    (ins: string) => {
      const ta = taRef.current;
      if (!ta) {
        setText((prev) => prev + ins);
        return;
      }
      const start = ta.selectionStart ?? text.length;
      const end = ta.selectionEnd ?? start;
      const next = text.slice(0, start) + ins + text.slice(end);
      setText(next);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + ins.length, start + ins.length);
      });
    },
    [text],
  );

  // F5 input-target dropdown options (every mode — the toolbar no longer has a
  // target segment (复审收敛：分屏目标=当前 pane 无切换语义); unified mode keeps
  // this legacy select bound to the same activePaneId field).
  const targetOptions = useMemo(() => {
    return panes
      .filter((p) => p.tab_id === activeTabId)
      .map((p) => {
        const a = agents.find((x) => x.pane_id === p.pane_id);
        const shortId = p.pane_id.split(":p")[1] ?? "";
        return { paneId: p.pane_id, label: a ? agentDisplayName(a) : `shell ${shortId}` };
      });
  }, [panes, agents, activeTabId]);

  const canSend =
    paneId !== null && (text.trim().length > 0 || atts.length > 0) && !sending && status !== "no-server";

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    for (const file of list) {
      if (!isImageFile(file)) {
        pushToast("error", `不支持的文件类型：${file.name}`);
        continue;
      }
      try {
        let filePath = "";
        try {
          filePath = window.herdr.pathForFile(file) || "";
        } catch {
          filePath = "";
        }
        if (!filePath) {
          const data = await readFileAsDataUrl(file);
          filePath = await window.herdr.fsSaveTemp({ data, name: file.name });
        }
        const preview = URL.createObjectURL(file);
        setAtts((prev) => {
          if (prev.some((a) => a.path === filePath)) {
            URL.revokeObjectURL(preview);
            return prev;
          }
          return [...prev, { id: `${filePath}-${Date.now()}`, path: filePath, name: file.name, preview }];
        });
      } catch (err: any) {
        pushToast("error", `无法添加图片：${err?.message ?? file.name}`);
      }
    }
  };

  const removeAtt = (id: string) => {
    setAtts((prev) => {
      const hit = prev.find((a) => a.id === id);
      if (hit) URL.revokeObjectURL(hit.preview);
      return prev.filter((a) => a.id !== id);
    });
  };

  const send = async () => {
    if (!canSend || !paneId) return;
    const refs = atts.map((a) => atRef(a.path)).join(" ");
    const body = [refs, text.trim()].filter(Boolean).join("\n");
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await deliver(body);
      setText("");
      setAtts((prev) => {
        for (const a of prev) URL.revokeObjectURL(a.preview);
        return [];
      });
      setTimeout(() => void refreshPane(paneId), 300);
    } catch (err: any) {
      setError(err?.message ?? "发送失败");
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  };

  const deliver = async (payload: string) => {
    if (!paneId) return;
    if (isSlashCommand(payload)) {
      await sendTuiSlash(paneId, payload);
      return;
    }
    if (agent) {
      try {
        await agentPrompt(agent.pane_id, payload);
      } catch (err: any) {
        if (!/not an active named agent/i.test(String(err?.message ?? err))) throw err;
        await paneSendText(paneId, payload);
      }
    } else {
      await paneSendText(paneId, payload);
    }
  };

  const interrupt = async (keys: string[]) => {
    if (!paneId) return;
    try {
      if (agent) {
        try {
          await agentSendKeys(agent.pane_id, keys);
        } catch (err: any) {
          // Authority-reported agents (and pre-registration agents) are not
          // addressable via agent.send_keys — degrade to the pane channel
          // (same fallback policy as deliver()).
          if (!/not an active named agent/i.test(String(err?.message ?? err))) throw err;
          await paneSendKeys(paneId, keys);
        }
      } else {
        await paneSendKeys(paneId, keys);
      }
      // Toast confirms the key actually went out (D6 contract: esc toast).
      pushToast("info", `已发送 ${keys.join(" ")}`);
      setTimeout(() => void refreshPane(paneId), 300);
    } catch (err: any) {
      pushToast("error", `发送按键失败：${err?.message ?? ""}`);
    }
  };

  const sendSlash = async (cmd: string) => {
    if (!paneId || status === "no-server") return;
    try {
      await sendTuiSlash(paneId, cmd);
      setTimeout(() => void refreshPane(paneId), 500);
    } catch (err: any) {
      pushToast("error", err?.message ?? "发送失败");
    }
  };

  // ---- F5 toolbar segments ----

  /** 引用文件: first-level file entries across the tab's pane cwds. */
  const openTbAttach = async () => {
    if (openMenu === "tb-attach") {
      setOpenMenu(null);
      return;
    }
    setToolsOpen(false); // M2: overlay 互斥——引用文件菜单与命令面板不叠开
    setOpenMenu("tb-attach");
    // m4 review: drop the previous listing FIRST so a slow fs walk never
    // flashes the stale files of another tab/pane.
    setTbFiles([]);
    const roots: string[] = [];
    for (const p of panes) {
      if (p.tab_id !== activeTabId) continue;
      const c = (p.cwd ?? "").trim();
      if (c && !roots.includes(c)) roots.push(c);
    }
    const files: Array<{ name: string; path: string }> = [];
    for (const root of roots) {
      try {
        const tree = await window.herdr.fsTree(root, 1);
        if (!Array.isArray(tree)) continue;
        for (const node of tree) {
          if (node.type !== "file") continue;
          if (!files.some((f) => f.path === node.path)) files.push({ name: node.name, path: node.path });
        }
      } catch {
        /* unreadable root — skip it */
      }
    }
    setTbFiles(files.slice(0, 40));
  };

  /** F5 模型: pick a preset → send `/model <id>` through the V4 slash channel. */
  const pickTbModel = (id: string) => {
    setOpenMenu(null);
    void sendSlash(`/model ${id}`);
  };

  /** V9 命令按钮：以按钮形态打开 V4 slash palette（未输入 "/" 时展示全量列表）。 */
  const openTools = () => {
    setOpenMenu(null);
    setSlashOpen(false);
    setToolsOpen((v) => !v);
  };

  const presets = useMemo(() => modelPresetsFor(agent?.agent), [agent?.agent]);
  const modelText = sessionBar.model || (agent ? agent.agent : "");
  const agentStatus = agent?.agent_status;
  const working = agentStatus === "working" || agentStatus === "blocked";
  const statusWord = agent ? (STATUS_WORD[agentStatus ?? "unknown"] ?? agentStatus ?? "—") : "终端";
  // V9：模型段 label 截 12 字符（JS 截断 + title 全名，不依赖 CSS ellipsis）。
  const modelLabel = modelText.length > 12 ? `${modelText.slice(0, 11)}…` : modelText;
  // V9 状态徽标：working 独占 CSS 转圈；blocked/idle/done 用彩色状态点。
  const spinning = agentStatus === "working";

  // ---- m3 review: keyboard support for the shared toolbar menu ----
  // The open menu is flattened into data so ↑/↓/Enter act on the same list the
  // mouse clicks (rendered below). NOTE: model items keep `label` as their
  // ONLY text — the F5 contract extracts the model id from textContent.
  interface TbItem {
    key: string;
    label: string;
    hint?: string;
    icon: "file" | "plus" | null;
    mono?: boolean;
    title?: string;
    active: boolean;
    run: () => void;
  }
  /** 模型预设项：label 即 id（F5 契约从 textContent 提取模型名）。ghost 态也渲染。 */
  const modelItems: TbItem[] = presets.map((id) => ({
    key: id,
    label: id,
    icon: null,
    mono: true,
    active: id === modelText,
    run: () => pickTbModel(id),
  }));
  /** 引用文件项：首项 = 上传图片（原 + 段行为），其后为 cwd 一级文件。 */
  const attachItems: TbItem[] = [
    {
      key: "__upload",
      label: "上传图片…",
      icon: "plus" as const,
      title: "选择本地图片附件（也可拖放或粘贴到输入框）",
      active: false,
      run: () => {
        setOpenMenu(null);
        fileRef.current?.click();
      },
    },
    ...tbFiles.map((f) => ({
      key: f.path,
      label: f.name,
      icon: "file" as const,
      title: f.path,
      active: false,
      run: () => {
        setOpenMenu(null);
        insertAtCursor(atRef(f.name) + " ");
      },
    })),
  ];
  // Open menu 的条目驱动 ↑/↓/Enter；ghost（closed）面板不响应键盘。
  const tbItems: TbItem[] = openMenu === "tb-attach" ? attachItems : openMenu === "tb-model" ? modelItems : [];
  const tbHl = Math.min(tbIdx, Math.max(0, tbItems.length - 1));

  useEffect(() => {
    setTbIdx(0);
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu || tbItems.length === 0) return;
    // Capture phase: consume the keys BEFORE the textarea's own handler, so a
    // menu never co-fires a send (Enter) while it is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setTbIdx((i) => (i + 1) % tbItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setTbIdx((i) => (i - 1 + tbItems.length) % tbItems.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        tbItems[Math.min(tbIdx, tbItems.length - 1)]?.run();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpenMenu(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMenu, tbItems, tbIdx]);

  useEffect(() => {
    setModeOver(null);
    setEffortOver(null);
    setOpenMenu(null);
    setToolsOpen(false); // m1: 命令面板不跨 pane 泄漏
  }, [paneId]);

  useEffect(() => {
    if (modeOver && modeIdOf(sessionBar.mode) === modeOver) setModeOver(null);
    if (effortOver && (sessionBar.effort ?? "").toLowerCase() === effortOver) setEffortOver(null);
  }, [sessionBar.mode, sessionBar.effort, modeOver, effortOver]);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openMenu]);

  // V9 tools-button 呼出的命令面板：点击 composer 外部或按 Esc 关闭（textarea
  // 聚焦时的 Esc 由其自身 handler 处理；这里覆盖焦点在按钮上的情况）。
  useEffect(() => {
    if (!toolsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToolsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolsOpen]);

  // M1: 常驻面板的 ghost 态不得成为隐形交互面——除 V8 点击契约要求的权限模式
  // 组头（data-ghost-clickable）外，全部按钮 inert（不可聚焦/不可点/退出 a11y
  // 树），展开后恢复。React 18 无 inert prop，经 ref 命令式赋值。
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const ghost = !openMenu;
    panel.querySelectorAll("button").forEach((el) => {
      if (el instanceof HTMLElement) el.inert = ghost && el.dataset.ghostClickable === undefined;
    });
  }, [openMenu, agent]);

  const grokLike = !!agent && /grok/i.test(agent.agent);
  const effortId = effortOver ?? sessionBar.effort ?? (grokLike ? "medium" : undefined);
  const effortText = effortLabel(effortId);
  const modeId = modeOver ?? (agent ? modeIdOf(sessionBar.mode) : undefined);
  const modeOpt = MODE_OPTIONS.find((m) => m.id === modeId);

  const pickEffort = (id: string, cmd: string) => {
    setEffortOver(id);
    setOpenMenu(null);
    void sendSlash(cmd);
  };

  const pickMode = (id: ModeId, cmd: string) => {
    setOpenMenu(null);
    if (id === modeId) return;
    // Ask has no dedicated on-command: toggle off the active mode.
    let toSend = cmd;
    if (id === "ask") {
      if (modeId === "bypass") toSend = "/always-approve";
      else if (modeId === "auto") toSend = "/auto";
      else if (modeId === "plan") toSend = "/plan";
      else return;
    }
    if (!toSend) return;
    setModeOver(id);
    void sendSlash(toSend);
  };

  return (
    <div className="composer-wrap">
      {error && <div className="inline-error">{error}</div>}
      <div
        ref={composerRef}
        className={`composer${dragOver ? " drag-over" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
        }}
      >
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
        {atts.length > 0 && (
          <div className="composer-atts" data-testid="composer-atts">
            {atts.map((a) => (
              <div className="composer-att" data-testid="composer-att" key={a.id} title={a.path}>
                <img src={a.preview} alt={a.name} />
                <button
                  type="button"
                  className="composer-att-x"
                  aria-label={`移除 ${a.name}`}
                  onClick={() => removeAtt(a.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {/* V9 Esc 中断（D6 契约）：ghost chip 悬浮于 composer 卡右上角，仅
            working 态渲染；不占工具条段位（也远离 F5 几何断言的按钮行）。 */}
        {agent && working && (
          <button
            type="button"
            className="composer-esc-chip"
            data-testid="composer-esc"
            disabled={!paneId || status === "no-server"}
            title="向前台程序发送 Esc"
            onClick={() => void interrupt(["esc"])}
          >
            Esc 中断
          </button>
        )}
        <textarea
          ref={taRef}
          value={text}
          placeholder={
            agent
              ? "发送消息... (@ 引用文件 · / 命令 · 粘贴图片)"
              : pane
                ? "输入 shell 命令…（Enter 执行）"
                : "先选择一个窗格"
          }
          disabled={!paneId || status === "no-server"}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const images: File[] = [];
            for (const item of Array.from(items)) {
              if (item.kind === "file" && item.type.startsWith("image/")) {
                const f = item.getAsFile();
                if (f) images.push(f);
              }
            }
            if (images.length) {
              e.preventDefault();
              void addFiles(images);
            }
          }}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            setSlashIdx(0);
            setToolsOpen(false); // typing takes over from the tools-button form
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
                setToolsOpen(false);
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
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml"
            multiple
            hidden
            data-testid="composer-file-input"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {/* V9 Composer 工具条：离散圆角描边按钮组（对标参考截图），替换原
              Double-Bezel 分段胶囊。左组 = ⊕引用 / 📎图片 / ▦模型∨ / ✦对话chip /
              ▦命令；右组 = 状态徽标 + 发送⏎。effort/mode 并入模型下拉的分组
              （testid 保留在组容器：composer-effort / composer-mode /
              composer-mode-menu）；agent 徽标段（composer-brand）删除；
              Esc ghost chip 移至卡片右上角。
              NOTE: V8 既有 testid（composer-attach/composer-status/composer-model）
              全部保留；toolbar-menu 面板在 agent pane 常驻（closed = ghost：
              opacity:0 + pointer-events:none），V8 对 effort/mode 文本的断言与
              「点击 composer-mode 展开 composer-mode-menu」依赖这一点。 */}
          <div className="composer-toolbar-zone" ref={menuRef}>
            <div className="composer-toolbar" data-testid="composer-toolbar">
              {/* 1) ⊕ 引用文件：cwd 一级文件点选插入 @相对路径（shell 也可用） */}
              <button
                type="button"
                className={`tb-btn tb-round${openMenu === "tb-attach" ? " on" : ""}`}
                data-testid="toolbar-attach"
                disabled={!paneId || status === "no-server"}
                title="引用文件（点选插入 @相对路径）"
                onClick={() => void openTbAttach()}
              >
                <IconPlus size={14} />
              </button>
              {/* 2) 📎 上传图片（V8 既有交互：file input → 附件缩略图） */}
              <button
                type="button"
                className="tb-btn tb-round"
                data-testid="composer-attach"
                disabled={!paneId || status === "no-server"}
                title="上传图片（也可拖放或粘贴到输入框）"
                onClick={() => fileRef.current?.click()}
              >
                <IconPaperclip size={14} />
              </button>
              {/* 3) 模型 ∨（仅 agent，shell pane 隐藏）：模型预设 + 力度/权限 分组。
                 无图标（m4：与命令钮的 ▦ 区分，只留 label+chevron）。 */}
              {agent && modelText && (
                <button
                  type="button"
                  className={`tb-btn${openMenu === "tb-model" ? " on" : ""}`}
                  data-testid="toolbar-model"
                  aria-expanded={openMenu === "tb-model"}
                  title={`模型 ${modelText} — 选择预设即发送 /model <名>`}
                  onClick={() => {
                    setToolsOpen(false); // M2: overlay 互斥——模型面板与命令面板不叠开
                    setOpenMenu(openMenu === "tb-model" ? null : "tb-model");
                  }}
                >
                  <span className="tb-btn-label" data-testid="composer-model">
                    {modelLabel}
                  </span>
                  <IconChevron size={9} />
                </button>
              )}
              {/* 4) ✦ 对话 chip（参考图的激活 chip 形态）：对话视图激活时显示，
                 点 × 切到原始输出（chip 消失）；原始输出视图下不渲染 */}
              {layoutMode === "separate" && view === "chat" && paneId && (
                <div className="view-chip" data-testid="view-chip" title="对话视图已启用">
                  <span className="view-chip-glyph" aria-hidden>
                    ✦
                  </span>
                  <span className="view-chip-label">对话</span>
                  <button
                    type="button"
                    className="view-chip-x"
                    data-testid="chip-x"
                    aria-label="切到原始输出"
                    title="切到原始输出"
                    onClick={() => onPickView("raw")}
                  >
                    ×
                  </button>
                </div>
              )}
              {/* 5) ▦ 命令：V4 slash palette 的按钮形态（shell pane 无命令 → 隐藏） */}
              {agent && (
                <button
                  type="button"
                  className={`tb-btn${toolsOpen ? " on" : ""}`}
                  data-testid="tools-button"
                  aria-expanded={toolsOpen}
                  title="斜杠命令"
                  onClick={openTools}
                >
                  <IconGrid size={13} />
                  命令
                </button>
              )}
              <span className="tb-spring" aria-hidden />
              {/* 6) 状态徽标：working = CSS 转圈 / blocked 琥珀 / idle 绿 / done 蓝 */}
              <div
                className={`composer-status s-${agentStatus ?? "shell"}`}
                data-testid="composer-status"
                title={`${statusWord}${sessionBar.ctx ? ` · 上下文 ${sessionBar.ctx}` : ""}`}
              >
                {spinning ? <span className="status-spin" aria-hidden /> : <span className="status-dot" aria-hidden />}
                <span className="status-word">{statusWord}</span>
              </div>
              {/* 7) 发送 ⏎：描边矩形；working 态切红描边「■ 中断」 */}
              <button
                type="button"
                className={`tb-btn send-btn${working ? " stop" : ""}`}
                data-testid="send-button"
                title={working ? "中断（Ctrl+C）" : agent ? "发送" : "执行"}
                disabled={!paneId || (!working && !canSend && !sending)}
                onClick={() => (working ? void interrupt(["ctrl+c"]) : void send())}
              >
                {working ? (
                  <>
                    <IconStop size={10} /> 中断
                  </>
                ) : (
                  <>
                    {sending ? "发送中" : "发送"}
                    <kbd className="send-key">⏎</kbd>
                  </>
                )}
              </button>
            </div>
            {/* 共享浮层（glass 面板）：agent pane 常驻（closed = ghost），内容随
               openMenu 切换：tb-attach = 引用文件列表；其余 = 模型预设 + 推理
               力度 + 权限模式 两组。ghost 态仅 composer-mode 头保留可点（V8）。 */}
            {(openMenu || agent) && (
              <div
                ref={panelRef}
                className={`toolbar-menu${openMenu ? "" : " ghost"}`}
                data-testid="toolbar-menu"
                role={openMenu ? "menu" : undefined}
                aria-hidden={!openMenu}
              >
                {openMenu === "tb-attach" ? (
                  <>
                    {tbFiles.length === 0 && <div className="tb-menu-empty">当前目录没有可引用的文件</div>}
                    {attachItems.map((item, i) => (
                      <button
                        type="button"
                        key={item.key}
                        role="menuitem"
                        className={`tb-menu-item${item.mono ? " mono" : ""}${item.active ? " active" : ""}${i === tbHl ? " kb" : ""}`}
                        data-testid="toolbar-menu-item"
                        title={item.title}
                        // keep textarea focus on click (mousedown would blur it)
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setTbIdx(i)}
                        ref={(el) => {
                          // keyboard highlight stays in view (slash-palette parity)
                          if (i === tbHl) el?.scrollIntoView({ block: "nearest" });
                        }}
                        onClick={item.run}
                      >
                        {item.icon === "file" && <IconFile size={12} />}
                        {item.icon === "plus" && <IconPlus size={12} />}
                        <span className="tb-menu-name">{item.label}</span>
                        {item.hint && <span className="tb-menu-hint">{item.hint}</span>}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <div className="tb-group-label">模型预设</div>
                    {modelItems.map((item, i) => (
                      <button
                        type="button"
                        key={item.key}
                        role={openMenu ? "menuitem" : undefined}
                        tabIndex={openMenu ? undefined : -1}
                        className={`tb-menu-item mono${item.active ? " active" : ""}${i === tbHl ? " kb" : ""}`}
                        data-testid="toolbar-menu-item"
                        title={`/model ${item.label}`}
                        // keep textarea focus on click (mousedown would blur it)
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setTbIdx(i)}
                        onClick={item.run}
                      >
                        <span className="tb-menu-name">{item.label}</span>
                      </button>
                    ))}
                    <div className="tb-menu-sep" aria-hidden />
                    {/* 推理力度组（原 effort 独立段并入；testid 在组容器上） */}
                    <div className="tb-group" data-testid="composer-effort" title="推理力度 — 选择即发送 /effort <级>">
                      <div className="tb-group-head">推理力度 · {effortText || "—"}</div>
                      <div className="tb-group-items">
                        {EFFORT_OPTIONS.map((opt) => (
                          <button
                            type="button"
                            key={opt.id}
                            role={openMenu ? "menuitem" : undefined}
                            tabIndex={openMenu ? undefined : -1}
                            className={`tb-group-item${opt.id === effortId ? " active" : ""}`}
                            onClick={() => pickEffort(opt.id, opt.cmd)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 权限模式组（原 mode 独立段并入）；头部 testid 保留为
                       composer-mode——ghost 态点击它即展开面板（V8 契约） */}
                    <div className="tb-group" title="权限模式">
                      {/* data-ghost-clickable：ghost 态唯一保留点击的元素（V8 契约），
                         命中面由 CSS 缩到 2×2；不 inert（inert 会杀死点击）。 */}
                      <button
                        type="button"
                        className="tb-group-head tb-group-head-btn"
                        data-testid="composer-mode"
                        data-ghost-clickable=""
                        tabIndex={openMenu ? undefined : -1}
                        aria-hidden={openMenu ? undefined : true}
                        title="权限模式 — 点击展开"
                        onClick={() => {
                          if (!openMenu) setOpenMenu("tb-model");
                        }}
                      >
                        权限模式 · {modeOpt?.label ?? "Ask"}
                        <IconChevron size={9} />
                      </button>
                      <div className="tb-group-items" data-testid="composer-mode-menu">
                        {MODE_OPTIONS.map((opt) => (
                          <button
                            type="button"
                            key={opt.id}
                            role={openMenu ? "menuitem" : undefined}
                            tabIndex={openMenu ? undefined : -1}
                            className={`tb-group-item tone-${opt.tone}${opt.id === modeId ? " active" : ""}`}
                            onClick={() => pickMode(opt.id, opt.cmd)}
                          >
                            <span>
                              <span className="composer-dot" aria-hidden />
                              {opt.label}
                            </span>
                            <span className="hint">{opt.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
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
          <span className="composer-spacer" />
        </div>
      </div>
    </div>
  );
}
