import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(
  new URL("../../../packages/backend/src/services/geminiAi.js", import.meta.url)
);

const email = "zz-email-7H4kP2mQ9sL@example.test";
const password = "zz-password-7H4kP2mQ9sL";
const apiKey = "zz-apikey-7H4kP2mQ9sL";
const emailPrefix = email.slice(0, 16);
const passwordPrefix = password.slice(0, 16);
const apiKeyPrefix = apiKey.slice(0, 16);

function scrub(text: string) {
  return text
    .split(email)
    .join("[email]")
    .split(password)
    .join("[password]")
    .split(apiKey)
    .join("[api-key]");
}

function runHelper(): Promise<{ stdout: string; stderr: string; status: number | null }> {
  const script = `
    const secrets = {
      email: process.env.user_email,
      password: process.env.user_password,
      apiKey: process.env.gemini_api_key,
    };
    const captured = [];
    const push = (args) => {
      captured.push(args.map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) return arg.stack || (arg.name + ": " + arg.message);
        try { return JSON.stringify(arg); } catch { return String(arg); }
      }).join(" "));
    };
    for (const method of ["log", "info", "warn", "error", "debug"]) {
      console[method] = (...args) => push(args);
    }
    let fetchCalled = 0;
    globalThis.fetch = async () => {
      fetchCalled += 1;
      throw new Error(
        "diagnostic-marker " + secrets.email + " " + secrets.password + " " + secrets.apiKey
      );
    };
    const mod = await import(process.env.GEMINI_MODULE_URL);
    try { await mod.uploadsyllabusalt("dGVzdA==", 20); } catch {}
    try { await mod.refineQuestions("What is a lock?", "Databases"); } catch {}
    const blob = captured.join("\\n");
    const report = {
      fetchCalled,
      email: blob.includes(secrets.email),
      password: blob.includes(secrets.password),
      apiKey: blob.includes(secrets.apiKey),
      emailPrefix: blob.includes(secrets.email.slice(0, 16)),
      passwordPrefix: blob.includes(secrets.password.slice(0, 16)),
      apiKeyPrefix: blob.includes(secrets.apiKey.slice(0, 16)),
      keptDiagnostic: blob.includes("diagnostic-marker"),
    };
    process.stdout.write(JSON.stringify(report));
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {
        env: {
          ...process.env,
          user_email: email,
          user_password: password,
          gemini_api_key: apiKey,
          GEMINI_API_KEY: apiKey,
          GEMINI_MODULE_URL: new URL("../../../packages/backend/src/services/geminiAi.js", import.meta.url).href,
        },
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ stdout, stderr: scrub(stderr), status });
    });
  });
}

describe("geminiAi secret logging", () => {
  it("does not print configured email, password, or API key values", () => {
    const source = readFileSync(modulePath, "utf8");
    assert.equal(
      /console\.(log|debug|info|warn|error)\s*\(\s*process\.env\.(user_email|user_password|gemini_api_key|GEMINI_API_KEY)\b/.test(
        source
      ),
      false
    );
  });

  it("does not log secret values or prefixes when the helper loads or a request fails", async () => {
    const { stdout, stderr, status } = await runHelper();
    assert.equal(status, 0, stderr || scrub(stdout));
    const report = JSON.parse(stdout);
    assert.ok(report.fetchCalled > 0, "error path did not run");
    assert.equal(report.keptDiagnostic, true);
    assert.equal(report.email, false);
    assert.equal(report.password, false);
    assert.equal(report.apiKey, false);
    assert.equal(report.emailPrefix, false);
    assert.equal(report.passwordPrefix, false);
    assert.equal(report.apiKeyPrefix, false);
    assert.equal(emailPrefix.length >= 12, true);
    assert.equal(passwordPrefix.length >= 12, true);
    assert.equal(apiKeyPrefix.length >= 12, true);
  });
});
