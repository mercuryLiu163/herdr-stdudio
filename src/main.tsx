import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useStore } from "./store";
import { initTheme } from "./theme";
import "./styles/global.css";

// Restore the persisted theme before the first paint (F1).
initTheme();

// Debug/test seam: lets external tooling (CDP) assert on live app state.
(window as any).__herdr_store = useStore;

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<App />);
}
