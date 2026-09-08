import { useStore } from "../store";
import { IconLayers } from "./icons";

const statusText: Record<string, string> = {
  working: "工作中",
  idle: "空闲",
  blocked: "待确认",
  done: "已完成",
  unknown: "未知",
};

export function Sidebar() {
  const workspaces = useStore((s) => s.workspaces);
  const agents = useStore((s) => s.agents);
  const activeWs = useStore((s) => s.activeWorkspaceId);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const status = useStore((s) => s.status);

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
        const activeAgentCount = wsAgents.filter((a) => a.agent_status === "working" || a.agent_status === "blocked").length;
        return (
          <button
            key={w.workspace_id}
            className={`ws-item ${activeWs === w.workspace_id ? "active" : ""}`}
            onClick={() => selectWorkspace(w.workspace_id)}
          >
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
          </button>
        );
      })}
    </div>
  );
}
