// Orchestrator: build → protocol tests → E2E → consolidated report.
import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = path.join(PROJECT, "tests", "artifacts");
fs.mkdirSync(ARTIFACTS, { recursive: true });

console.log("════════════════════════════════════════════");
console.log(" Herdr Studio test suite");
console.log("════════════════════════════════════════════\n");

console.log("[0/3] building app…");
execSync("npm run build", { cwd: PROJECT, stdio: "inherit" });

const report = { api: null, e2e: null, startedAt: new Date().toISOString() };

async function runScript(label, file) {
  console.log(`\n── [${label}] ${file} ──────────────────────────`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(PROJECT, "tests", file)], {
      cwd: PROJECT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => resolve(code === 0));
  });
}

console.log("\n[1/3] protocol-layer tests");
report.api = await runScript("api", "api.test.mjs");

console.log("\n[2/3] e2e tests (CDP)");
report.e2e = await runScript("e2e", "e2e.test.mjs");

report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));

console.log("\n════════════════════════════════════════════");
console.log(` api:      ${report.api ? "PASS" : "FAIL"}`);
console.log(` e2e:      ${report.e2e ? "PASS" : "FAIL"}`);
console.log(` artifacts: ${ARTIFACTS}`);
console.log("════════════════════════════════════════════");
process.exit(report.api && report.e2e ? 0 : 1);
