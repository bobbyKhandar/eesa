import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (!child.pid) continue;
    if (windows) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
}

for (const [command, args] of [
  [windows ? "npm.cmd" : "npm", ["run", "dev:frontend"]],
  [process.execPath, ["scripts/dev-ai.mjs"]],
]) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    detached: !windows,
    shell: windows && command === "npm.cmd",
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`Development server could not start: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => stop(code ?? (signal ? 1 : 0)));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
