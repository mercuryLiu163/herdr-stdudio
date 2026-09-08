import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useStore } from "./store";
import "./styles/global.css";

// Debug/test seam: lets external tooling (CDP) assert on live app state.
(window as any).__herdr_store = useStore;

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(<App />);
}
