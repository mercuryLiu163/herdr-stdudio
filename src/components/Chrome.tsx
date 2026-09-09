import { useStore } from "../store";
import { toggleTheme } from "../theme";
import { IconClose, IconGear, IconMaximize, IconMinimize, IconMoon, IconPanelRight, IconSun } from "./icons";

const statusLabel: Record<string, string> = {
  connected: "已连接",
  connecting: "连接中",
  reconnecting: "重连中",
  "no-server": "未运行",
};

export function TitleBar() {
  const status = useStore((s) => s.status);
  const rightSidebarOpen = useStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useStore((s) => s.toggleRightSidebar);
  const dot = status === "connected" ? "ok" : status === "no-server" ? "bad" : "warn";
  return (
    <div className="titlebar">
      <span className="titlebar-name">
        Herdr <em>Studio</em>
      </span>
      <span className="conn-pill">
        <span className={`conn-dot ${dot}`} />
        {statusLabel[status] ?? status}
      </span>
      <div className="titlebar-actions">
        <button
          className="titlebar-btn"
          data-testid="theme-toggle"
          onClick={() => toggleTheme()}
          title="切换日夜主题"
        >
          <IconSun className="icon-sun" />
          <IconMoon className="icon-moon" />
        </button>
        <button
          className={`titlebar-btn ${rightSidebarOpen ? "on" : ""}`}
          data-testid="right-sidebar-toggle"
          onClick={() => toggleRightSidebar()}
          title="功能栏"
        >
          <IconPanelRight />
        </button>
      </div>
      <div className="win-controls">
        <button className="win-btn" onClick={() => window.herdr.win("min")} title="最小化">
          <IconMinimize />
        </button>
        <button className="win-btn" onClick={() => window.herdr.win("max")} title="最大化">
          <IconMaximize />
        </button>
        <button className="win-btn close" onClick={() => window.herdr.win("close")} title="关闭">
          <IconClose />
        </button>
      </div>
    </div>
  );
}

export function Rail() {
  return (
    <div className="rail">
      <div className="rail-logo">H</div>
      <div style={{ flex: 1 }} />
      <button className="rail-btn" title="设置（即将推出）" disabled>
        <IconGear />
      </button>
    </div>
  );
}
