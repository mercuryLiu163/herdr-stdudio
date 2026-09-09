import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useStore, agentForPane, agentDisplayName } from "../store";
import { AnsiView } from "../ansi";
import { parseTranscript } from "../chat-parser";
import type { PaneLayout, PaneLayoutEntry, PaneRect } from "../types";
import { paneLayout, paneResize, agentPrompt, paneSendText, paneSendKeys, agentSendKeys } from "../api";
import { IconBook, IconSend, IconTerminal } from "./icons";
import { IconColumns, IconMosaic } from "./icons";

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
  const tab = useStore((s) => s.tabs.find((t) => t.tab_id === s.activeTabId) ?? null);
  const panes = useStore((s) => s.panes.filter((p) => p.tab_id === s.activeTabId));
  const pane = useStore((s) => s.panes.find((p) => p.pane_id === s.activePaneId) ?? null);
  const agents = useStore((s) => s.agents);
  const agent = useStore((s) => agentForPane(s.agents, s.activePaneId));
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
        {panes.length > 0 && (
          <div className="pane-chips">
            {panes.map((p) => {
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
          <AnsiView text={output.text} />
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

/** F4 chat view: the pane transcript parsed into a conversation thread. */
function ChatView() {
  const paneId = useStore((s) => s.activePaneId);
  const output = useStore((s) => (s.activePaneId ? s.outputs[s.activePaneId] : undefined));
  const agents = useStore((s) => s.agents);
  const refresh = useStore((s) => s.refreshPaneOutput);
  const status = useStore((s) => s.status);
  const agent = agentForPane(agents, paneId);

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
    <div className="reader-wrap">
      <div className="reader-card chat-card" data-testid="reader-card">
        <ReaderMeta agent={agent} output={output} paneId={paneId} refresh={refresh} />
        {output?.failed && !output?.text ? (
          <div className="chat-thread" data-testid="chat-thread">
            <div className="chat-empty">读取输出失败。窗格可能刚刚关闭，或处于 alternate screen。</div>
          </div>
        ) : output?.text ? (
          <ChatThread text={output.text} />
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

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > 160 ? line.slice(0, 159) + "…" : line;
}

function ChatThread({ text }: { text: string }) {
  const blocks = useMemo(() => parseTranscript(text), [text]);
  return (
    <div className="chat-thread" data-testid="chat-thread">
      {blocks.length === 0 && <div className="chat-empty">暂无对话内容。</div>}
      {blocks.map((b, i) => {
        switch (b.type) {
          case "user":
            return (
              <div key={i} className="chat-msg user" data-testid="msg-user">
                <div className="chat-bubble">{b.text}</div>
              </div>
            );
          case "assistant":
            return (
              <div key={i} className="chat-msg assistant" data-testid="msg-assistant">
                {b.text}
              </div>
            );
          case "tool":
            return (
              <details key={i} className="chat-msg tool" data-testid="msg-tool">
                <summary>
                  <span className="chat-tool-tag">tool</span>
                  {firstLine(b.text)}
                </summary>
                <pre>{b.text}</pre>
              </details>
            );
          case "code":
            return (
              <pre key={i} className="chat-msg code" data-testid="msg-code">
                {b.text}
              </pre>
            );
          case "meta":
            return (
              <div key={i} className="chat-meta" data-testid="msg-meta">
                {b.text}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

/**
 * F3 unified layout: every pane of the active tab positioned by the herdr
 * `pane.layout` rect snapshot (percentages of the tab area), draggable
 * splitters between cells that call `pane.resize` and re-snapshot.
 */
function Mosaic() {
  const panes = useStore((s) => s.panes.filter((p) => p.tab_id === s.activeTabId));
  const activeTabId = useStore((s) => s.activeTabId);
  const outputs = useStore((s) => s.outputs);
  const refreshPaneOutput = useStore((s) => s.refreshPaneOutput);
  const agents = useStore((s) => s.agents);
  const [layout, setLayout] = useState<PaneLayout | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const anyPaneId = panes[0]?.pane_id ?? null;

  const refetch = useCallback(async () => {
    if (!anyPaneId) return;
    try {
      const res = await paneLayout(anyPaneId);
      setLayout(res.layout ?? null);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(String(err?.message ?? err));
    }
  }, [anyPaneId]);

  // 1s layout snapshot polling while in unified mode (PRD), plus first fetch.
  // With no panes left in the tab: drop the stale snapshot and stop the timer.
  useEffect(() => {
    if (!anyPaneId) {
      setLayout(null);
      setLoadError(null);
      return;
    }
    void refetch();
    const t = setInterval(() => void refetch(), 1000);
    return () => clearInterval(t);
  }, [refetch, anyPaneId]);

  // Cells show raw output per pane; make sure each has fresh text.
  useEffect(() => {
    for (const p of panes) void refreshPaneOutput(p.pane_id);
    // panes is derived per render; depend only on the id list
  }, [panes.map((p) => p.pane_id).join(","), refreshPaneOutput]);

  const entries: PaneLayoutEntry[] = layout?.panes ?? [];
  const area: PaneRect | undefined = layout?.area;

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  const dragState = useRef<{
    splitId: string;
    startX: number;
    startY: number;
    direction: string;
  } | null>(null);
  // nit: detach the window mouseup listener if we unmount mid-drag.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    },
    [],
  );

  const beginDrag = (split: NonNullable<PaneLayout["splits"]>[number]) => (e: ReactMouseEvent) => {
    e.preventDefault();
    dragState.current = {
      splitId: split.id,
      startX: e.clientX,
      startY: e.clientY,
      direction: split.direction,
    };
    const onUp = (ev: MouseEvent) => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      const st = dragState.current;
      dragState.current = null;
      if (!st) return;
      const dx = ev.clientX - st.startX;
      const dy = ev.clientY - st.startY;
      void commitResize(st.splitId, st.direction, dx, dy);
    };
    window.addEventListener("mouseup", onUp);
    dragCleanupRef.current = () => window.removeEventListener("mouseup", onUp);
  };

  const commitResize = async (splitId: string, direction: string, dx: number, dy: number) => {
    const split = layout?.splits?.find((s) => s.id === splitId);
    if (!split || !layout) return;
    const isVertical = direction === "right"; // vertical divider between left|right
    const deltaPx = isVertical ? dx : dy;
    if (Math.abs(deltaPx) < 4) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const box = wrap.getBoundingClientRect();
    const totalPx = isVertical ? box.width : box.height;
    const amount = Math.min(0.9, Math.abs(deltaPx / totalPx));
    const dir = isVertical ? (deltaPx > 0 ? "right" : "left") : deltaPx > 0 ? "down" : "up";
    // Any pane inside the split's rect identifies the split to herdr.
    const paneInSplit = layout.panes.find(
      (p) =>
        p.rect.x >= split.rect.x &&
        p.rect.y >= split.rect.y &&
        p.rect.x + p.rect.width <= split.rect.x + split.rect.width + 1 &&
        p.rect.y + p.rect.height <= split.rect.y + split.rect.height + 1,
    );
    if (!paneInSplit) return;
    try {
      const res = await paneResize(paneInSplit.pane_id, dir, amount);
      if (res?.resize?.layout) setLayout(res.resize.layout);
      else void refetch();
    } catch {
      /* resize refused — next poll refreshes the snapshot anyway */
    }
  };

  return (
    <div className="mosaic-wrap">
      <div className="mosaic" data-testid="mosaic" ref={wrapRef}>
        {!layout && !loadError && <div className="rs-hint">正在读取布局…</div>}
        {loadError && <div className="rs-hint">读取布局失败：{loadError}</div>}
        {layout &&
          entries.map((entry) => {
            const out = outputs[entry.pane_id];
            const agent = agents.find((a) => a.pane_id === entry.pane_id);
            const shortId = entry.pane_id.split(":p")[1] ?? "";
            const key = entry.pane_id;
            const style: CSSProperties = area
              ? {
                  left: pct(entry.rect.x - area.x, area.width),
                  top: pct(entry.rect.y - area.y, area.height),
                  width: pct(entry.rect.width, area.width),
                  height: pct(entry.rect.height, area.height),
                }
              : {};
            return (
              <div key={key} className="mosaic-cell" data-testid={`mosaic-pane-${entry.pane_id}`} style={style}>
                <div className="mosaic-cell-head">
                  {agent ? (
                    <span className={`sdot ${agent.agent_status}`} />
                  ) : (
                    <IconTerminal size={11} />
                  )}
                  <span>{agent ? agentDisplayName(agent) : `shell ${shortId}`}</span>
                </div>
                <div className="mosaic-cell-body">
                  {out?.text ? <AnsiView text={out.text} /> : (
                    <div className="rs-hint" style={{ padding: "6px 10px" }}>
                      {out?.loading ? "正在读取输出…" : "暂无输出"}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        {layout &&
          (layout.splits ?? []).map((split) => {
            if (!area) return null;
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
                title="拖动调整布局"
              />
            );
          })}
      </div>
    </div>
  );
}

function Composer() {
  const paneId = useStore((s) => s.activePaneId);
  const pane = useStore((s) => s.panes.find((p) => p.pane_id === s.activePaneId) ?? null);
  const agent = useStore((s) => agentForPane(s.agents, s.activePaneId));
  const status = useStore((s) => s.status);
  const pushToast = useStore((s) => s.pushToast);
  const refreshPane = useStore((s) => s.refreshPaneOutput);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const canSend = paneId !== null && text.trim().length > 0 && !sending && status !== "no-server";

  const send = async () => {
    if (!canSend || !paneId) return;
    setSending(true);
    setError(null);
    try {
      if (agent) {
        // agent.* accepts the hosting pane id as target; more reliable than the
        // display name, which detected agents often don't have.
        await agentPrompt(agent.pane_id, text.trim());
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
        />
        <div className="composer-row">
          <button className="hint-key" onClick={() => void interrupt(["esc"])} disabled={!paneId}>
            Esc 中断
          </button>
          <button
            className="hint-key"
            onClick={() => void interrupt(["ctrl+c"])}
            disabled={!paneId}
          >
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
