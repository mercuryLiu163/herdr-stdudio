// Playwright globalSetup:确保 dist-electron 存在(_electron.launch 加载构建产物)。
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export default function globalSetup() {
  const main = path.join(PROJECT, "dist-electron", "main.js");
  const needsBuild = !fs.existsSync(main);
  if (needsBuild) {
    console.log("[global-setup] dist-electron/main.js 缺失,执行 npm run build:main …");
  }
  const r = spawnSync("npm", ["run", "build:main"], { cwd: PROJECT, shell: true, stdio: "inherit" });
  if (r.status !== 0) throw new Error("[global-setup] npm run build:main 失败");
}
