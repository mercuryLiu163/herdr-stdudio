// Build + launch the app with a screenshot hook, then wait for the PNG.
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(root, "..");
const out = path.resolve(project, "screenshots", `studio-${Date.now()}.png`);
fs.mkdirSync(path.dirname(out), { recursive: true });

console.log("building…");
execSync("npm run build", { cwd: project, stdio: "inherit" });

console.log("launching electron for capture →", out);
const electronBin = path.join(
  project,
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
const child = spawn(electronBin, [project, "--screenshot=" + out, "--exit"], {
  cwd: project,
  stdio: "inherit",
});
child.on("exit", (code) => {
  console.log("electron exited with", code);
  if (fs.existsSync(out)) console.log("SCREENSHOT_OK " + out);
  else {
    console.log("SCREENSHOT_MISSING");
    process.exit(1);
  }
});
