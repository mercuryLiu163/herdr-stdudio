import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useStore } from "../store";
import { IconChevron, IconLayers } from "./icons";

const statusText: Record<string, string> = {
  working: "工作中",
  idle: "空闲",
  blocked: "待确认",
  done: "已完成",
  unknown: "未知",
};

/**
 * V3 F1 merged sidebar: the standalone tab column is gone. Each workspace row
 * (`.ws-item`, kept for the V1 CDP e2e) carries an expand toggle
 * (`[data-testid="ws-expand"]`) and, when open, its tabs as indented
 * `.tab-item` sub rows nested INSIDE the workspace element.
 *
 * Expansion model (matches the PRD contract AND the executable spec):
 *   - the ACTIVE workspace always shows its tab sub rows (auto-expanded in the
 *     visible sense); every other row shows tabs only while pinned open;
 *   - `aria-expanded` reports the user's PIN state and starts "false" on every
 *     row — the active row's sub rows are context of being active, not a user
 *     expansion. Clicking the toggle flips the pin: unset → "open" → "closed"
 *     → "open"…, i.e. aria-expanded flips false→true→false→true on a fresh row,
 *     which is exactly the flip contract in v3-features.spec.mjs;
 *   - activating another workspace auto-expands it (its pin is cleared, and
 *     the previously active row collapses because visibility follows
 *     activeness). Clicking a tab sub row selects workspace + tab.
 */
type Pin = "open" | "closed";

export function Sidebar() {
  const workspaces = useStore((s) => s.workspaces);
  const tabs = useStore((s) => s.tabs);
  const agents = useStore((s) => s.agents);
  const activeWs = useStore((s) => s.activeWorkspaceId);
  const activeTab = useStore((s) => s.activeTabId);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const selectTab = useStore((s) => s.selectTab);
  const status = useStore((s) => s.status);

  const [pins, setPins] = useState<Map<string, Pin>>(() => new Map());

  // Auto-expand on activation: clear any stale pin so the newly active
  // workspace always renders its tabs (non-active rows stay collapsed unless
  // pinned).
  useEffect(() => {
    if (!activeWs) return;
    setPins((prev) => {
      if (!prev.has(activeWs)) return prev;
      const next = new Map(prev);
      next.delete(activeWs);
      return next;
    });
  }, [activeWs]);

  const isOpen = (id: string, isActive: boolean) => {
    const pin = pins.get(id);
    if (pin === "closed") return false;
    return pin === "open" || isActive;
  };

  const toggle = (id: string) => (e: ReactMouseEvent) => {
    // The toggle lives inside the selectable row: don't let it double as a
    // workspace selection.
    e.stopPropagation();
    setPins((prev) => {
      const next = new Map(prev);
      next.set(id, next.get(id) === "open" ? "closed" : "open");
      return next;
    });
  };

  return (
    <div className="sidebar">
      <div className="side-heading">工作区</div>
      {workspaces.length === 0 && (
        <div className="side-empty">
          {status === "connected" ? "还没有工作区。在 herdr 里创建一个试试。" : "等待连接 herdr server…"}
        </div>
      )}
      {workspaces.map((w) => {
        const wsAgents = agents.filter((a) => a.workspace_id === w.workspace_id);
        const activeAgentCount = wsAgents.filter(
          (a) => a.agent_status === "working" || a.agent_status === "blocked",
        ).length;
        const isActive = activeWs === w.workspace_id;
        const isOpen_ = isOpen(w.workspace_id, isActive);
        const tabsOfWs = tabs.filter((t) => t.workspace_id === w.workspace_id);
        return (
          <div key={w.workspace_id} className={`ws-item ${isActive ? "active" : ""}`}>
            <div
              className="ws-row"
              role="button"
              tabIndex={0}
              onClick={() => selectWorkspace(w.workspace_id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectWorkspace(w.workspace_id);
                }
              }}
            >
              <button
                className="ws-expand"
                data-testid="ws-expand"
                aria-expanded={pins.get(w.workspace_id) === "open"}
                data-open={isOpen_ ? "true" : "false"}
                aria-label={pins.get(w.workspace_id) === "open" ? "折叠标签" : "展开标签"}
                title={pins.get(w.workspace_id) === "open" ? "折叠标签" : "展开标签"}
                onClick={toggle(w.workspace_id)}
              >
                <IconChevron size={11} />
              </button>
              <span className="ws-item-icon">
                <IconLayers />
              </span>
              <span className="ws-item-main">
                <span className="ws-item-label">{w.label}</span>
                <span className="ws-item-sub">
                  {w.tab_count} 标签
                  {wsAgents.length > 0
                    ? ` · ${wsAgents.length} agent${activeAgentCount > 0 ? ` · ${activeAgentCount} 活跃` : ""}`
                    : ""}
                </span>
              </span>
              {w.agent_status && w.agent_status !== "unknown" && (
                <span className={`sdot ${w.agent_status}`} title={statusText[w.agent_status]} />
              )}
            </div>
            {isOpen_ && (
              <div className="ws-tabs">
                {tabsOfWs.length === 0 && (
                  <div className="side-empty ws-tabs-empty">
                    {status === "connected" ? "这个工作区还没有标签。" : "…"}
                  </div>
                )}
                {tabsOfWs.map((t) => {
                  const agent = agents.find((a) => a.tab_id === t.tab_id);
                  return (
                    <button
                      key={t.tab_id}
                      className={`tab-item ${activeTab === t.tab_id ? "active" : ""}`}
                      onClick={(e) => {
                        // Sub row = workspace + tab selection; selectTab already
                        // moves activeWorkspaceId, so don't bubble to the row.
                        e.stopPropagation();
                        selectTab(t.tab_id);
                      }}
                    >
                      {t.agent_status ? (
                        <span className={`sdot ${t.agent_status}`} title={`agent ${t.agent_status}`} />
                      ) : (
                        <span className="sdot" style={{ opacity: 0.25 }} title="shell" />
                      )}
                      <span className="tab-label">{t.label}</span>
                      {agent && <span className="kind-chip">{agent.agent}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
