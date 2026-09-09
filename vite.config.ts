import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src",
  base: "./",
  build: {
    outDir: "../dist-renderer",
    emptyOutDir: true,
  },
  server: {
    // Bind IPv4 explicitly: Electron's Chromium connects to 127.0.0.1 for
    // "localhost", and a ::1-only Vite listener leaves the window hidden.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
