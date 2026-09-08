import { useEffect, useRef, useState } from "react";
import { useStore, agentForPane, agentDisplayName } from "../store";
import { AnsiView } from "../ansi";
import { IconBook, IconSend, IconTerminal } from "./icons";
import { agentPrompt, paneSendText, paneSendKeys, agentSendKeys } from "../api";

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
  const [view, setView] = useState<"read" | "term">("read");

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
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    {pane.cwd}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="seg" style={{ flexShrink: 0 }}>
            <button className={view === "read" ? "on" : ""} onClick={() => setView("read")}>
              阅读
            </button>
            <button title="V2 将内嵌 xterm.js 终端" disabled>
              终端 · V2
            </button>
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
      {view === "read" ? <OutputReader /> : null}
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
      <div className="reader-card">
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
