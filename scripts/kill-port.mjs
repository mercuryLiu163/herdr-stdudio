// predev hook: clear OUR orphaned vite holding port 5173 before starting dev.
// Windows Ctrl+C via Git Bash often fails to reap the vite child, leaving the
// port blocked for the next `npm run dev`. Only kills a listener whose command
// line is this project's vite — anything else is left alone and reported.
import { execSync, spawnSync } from "node:child_process";

const PORT = 5173;

function getListenerPid() {
  try {
    const out = execSync("netstat -ano -p tcp", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const line of out.split("\n")) {
      if (line.includes(`:${PORT}`) && line.includes("LISTENING")) {
        const pid = parseInt(line.trim().split(/\s+/).pop(), 10);
        if (Number.isFinite(pid) && pid > 0) return pid;
      }
    }
  } catch {
    /* netstat unavailable */
  }
  return null;
}

function getCommandLine(pid) {
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
      { encoding: "utf8", timeout: 10_000 },
    );
    return (r.stdout || "").trim();
  } catch {
    return "";
  }
}

const pid = getListenerPid();
if (!pid) {
  console.log(`[predev] port ${PORT} free`);
  process.exit(0);
}

const cmd = getCommandLine(pid);
const isOurVite = /vite/i.test(cmd) && /herdr/i.test(cmd);
if (isOurVite) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    console.log(`[predev] killed orphaned vite (pid ${pid}) holding port ${PORT}`);
  } catch {
    console.log(`[predev] failed to kill pid ${pid} — kill it manually if dev fails to start`);
  }
} else {
  console.log(
    `[predev] port ${PORT} held by pid ${pid} (not our vite: ${cmd.slice(0, 80) || "unknown"}) — leaving it alone`,
  );
  console.log(`[predev] if dev fails with "Port ${PORT} is already in use", free it manually first`);
}
