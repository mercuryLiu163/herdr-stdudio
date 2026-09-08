import { useStore } from "../store";

export function TabList() {
  const activeWs = useStore((s) => s.activeWorkspaceId);
  const tabs = useStore((s) => s.tabs);
  const agents = useStore((s) => s.agents);
  const activeTab = useStore((s) => s.activeTabId);
  const selectTab = useStore((s) => s.selectTab);
  const status = useStore((s) => s.status);

  const tabsOfWs = tabs.filter((t) => t.workspace_id === activeWs);

  return (
    <div className="tabcol">
      <div className="tabcol-scroll">
        <div className="side-heading">标签</div>
        {tabsOfWs.length === 0 && (
          <div className="side-empty">
            {status === "connected" ? "这个工作区还没有标签。" : "…"}
          </div>
        )}
        {tabsOfWs.map((t) => {
          const agent = agents.find((a) => a.tab_id === t.tab_id);
          return (
            <button
              key={t.tab_id}
              className={`tab-item ${activeTab === t.tab_id ? "active" : ""}`}
              onClick={() => selectTab(t.tab_id)}
            >
              {t.agent_status ? (
                <span
                  className={`sdot ${t.agent_status}`}
                  title={`agent ${t.agent_status}`}
                />
              ) : (
                <span className="sdot" style={{ opacity: 0.25 }} title="shell" />
              )}
              <span className="tab-label">{t.label}</span>
              {agent && <span className="kind-chip">{agent.agent}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
