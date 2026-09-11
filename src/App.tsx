import { useEffect } from "react";
import { useStore } from "./store";
import { TitleBar, Rail } from "./components/Chrome";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";
import { RightSidebar, SidebarAppRail } from "./components/RightSidebar";
import { Toasts } from "./components/Toasts";
import { NoServer } from "./components/NoServer";

export function App() {
  const boot = useStore((s) => s.boot);
  const status = useStore((s) => s.status);
  const booted = useStore((s) => s.booted);
  const rightSidebarOpen = useStore((s) => s.rightSidebarOpen);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (status === "no-server" && booted) {
    return (
      <div className="shell">
        <TitleBar />
        <div className="shell-body">
          <NoServer />
        </div>
        <Toasts />
      </div>
    );
  }

  return (
    <div className="shell">
      <TitleBar />
      <div className="shell-body">
        <Rail />
        <Sidebar />
        <MainPane />
        {rightSidebarOpen && <RightSidebar />}
        {/* V5 F2: app switcher strip — always visible so an app opens the
            sidebar straight from the closed state (mcode icon-bar style). */}
        <SidebarAppRail />
      </div>
      <Toasts />
    </div>
  );
}
