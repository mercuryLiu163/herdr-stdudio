import { useEffect } from "react";
import { useStore } from "./store";
import { TitleBar, Rail } from "./components/Chrome";
import { Sidebar } from "./components/Sidebar";
import { TabList } from "./components/TabList";
import { MainPane } from "./components/MainPane";
import { RightSidebar } from "./components/RightSidebar";
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
        <TabList />
        <MainPane />
        {rightSidebarOpen && <RightSidebar />}
      </div>
      <Toasts />
    </div>
  );
}
