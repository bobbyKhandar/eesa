import { existsSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../packages/ai-pipeline/", import.meta.url));
const python = fileURLToPath(new URL(
  process.platform === "win32"
    ? "../packages/ai-pipeline/.venv/Scripts/python.exe"
    : "../packages/ai-pipeline/.venv/bin/python",
  import.meta.url,
));
if (!existsSync(python)) {
  writeSync(2, "AI pipeline venv is missing. Run npm run setup first.\n");
  process.exit(1);
}
const child = spawn(python, ["-u", "src/api/server.py"], { cwd, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(`Could not start the AI pipeline: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" || signal === "SIGTERM" ? 0 : 1);
});
