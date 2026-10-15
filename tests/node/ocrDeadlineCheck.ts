/**
 * Issue #157: a stalled OCR pipeline request must not outlive the overall
 * deadline. The axios status/result GETs used to run with the library default
 * timeout of zero, so a stalled response kept the caller pending even after the
 * attempt counter expired.
 *
 * These checks run the real client against a local pipeline that answers
 * nothing on the route under test, so the failure has to come from the client's
 * own deadline instead of from a mock.
 */
import { strict as assert } from "node:assert";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PipelineMode = "stall-submit" | "stall-status" | "stall-result" | "slow" | "healthy";

const TOTAL_TIMEOUT_MS = 600;
const REQUEST_TIMEOUT_MS = 250;
const POLL_INTERVAL_MS = 100;

interface PipelineServer {
  url: string;
  setMode(mode: PipelineMode): void;
  close(): Promise<void>;
}

function startPipeline(filePath: string): Promise<PipelineServer> {
  const state: { mode: PipelineMode; polls: number } = { mode: "healthy", polls: 0 };

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const reply = (payload: Record<string, unknown>) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    // Deliberately never respond: the client has to give up on its own.
    const stall = () => {
      res.writeHead(200, { "Content-Type": "application/json" });
    };

    if (req.method === "POST" && url === "/submit") {
      if (state.mode === "stall-submit") {
        stall();
        return;
      }
      reply({ success: true, batch_id: "batch-157" });
      return;
    }

    if (url.startsWith("/status/")) {
      if (state.mode === "stall-status") {
        stall();
        return;
      }
      state.polls += 1;
      // A slow but responsive pipeline must still succeed inside the budget.
      if (state.mode === "slow") {
        setTimeout(
          () =>
            reply({
              success: true,
              status: { status: state.polls > 1 ? "completed" : "processing" },
            }),
          200
        );
        return;
      }
      reply({ success: true, status: { status: state.polls > 1 ? "completed" : "processing" } });
      return;
    }

    if (url.startsWith("/result/")) {
      if (state.mode === "stall-result") {
        stall();
        return;
      }
      reply({
        success: true,
        result: {
          results: {
            [filePath]: {
              success: true,
              status: "success",
              combined_text: "Q1. Define latency",
              failed_pages: 0,
              total_pages: 1,
            },
          },
        },
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "not found" }));
  });

  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        setMode: mode => {
          state.mode = mode;
        },
        close: () =>
          new Promise<void>(done => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function assertBounded(result: {
  success: boolean;
  status?: string;
  error?: string;
  retryable?: boolean;
}): void {
  assert.equal(result.success, false);
  assert.equal(result.status, "failed");
  assert.equal(result.retryable, true);
  assert.match(result.error ?? "", /timed out/);
}

/** Every axios call in the service must carry a timeout, not the axios default. */
function assertEveryPipelineCallIsBounded(service: string): void {
  let index = service.indexOf("axios.");
  let calls = 0;
  while (index !== -1) {
    const open = service.indexOf("(", index + "axios.".length);
    assert.ok(open !== -1, "axios call without arguments");
    let depth = 0;
    let end = open;
    for (; end < service.length; end++) {
      if (service[end] === "(") depth++;
      else if (service[end] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const call = service.slice(index, end + 1);
    assert.match(call, /timeout:/, `unbounded axios call: ${call.slice(0, 60)}`);
    calls++;
    index = service.indexOf("axios.", end);
  }
  assert.ok(calls >= 4, `expected submit, status and result calls, saw ${calls}`);
}

async function timed(run: () => Promise<unknown>): Promise<{
  result: any;
  elapsedMs: number;
}> {
  const started = Date.now();
  const result = await run();
  return { result, elapsedMs: Date.now() - started };
}

export async function runOcrDeadlineChecks(): Promise<void> {
  const workDir = mkdtempSync(path.join(tmpdir(), "ocr-deadline-"));
  const filePath = path.join(workDir, "paper.pdf");
  writeFileSync(filePath, "%PDF-1.4 fake");

  const pipeline = await startPipeline(filePath);
  const env = [
    "OCR_PIPELINE_URL",
    "OCR_TOTAL_TIMEOUT_MS",
    "OCR_REQUEST_TIMEOUT_MS",
    "OCR_SUBMIT_TIMEOUT_MS",
    "OCR_POLL_INTERVAL_MS",
    "OCR_MAX_STATUS_ATTEMPTS",
  ];
  const previous = new Map(env.map(name => [name, process.env[name]] as const));

  // These are resolved once when the service module loads.
  process.env.OCR_PIPELINE_URL = pipeline.url;
  process.env.OCR_TOTAL_TIMEOUT_MS = String(TOTAL_TIMEOUT_MS);
  process.env.OCR_REQUEST_TIMEOUT_MS = String(REQUEST_TIMEOUT_MS);
  process.env.OCR_SUBMIT_TIMEOUT_MS = String(TOTAL_TIMEOUT_MS);
  process.env.OCR_POLL_INTERVAL_MS = String(POLL_INTERVAL_MS);
  process.env.OCR_MAX_STATUS_ATTEMPTS = "60";

  try {
    const service = await import("../../packages/backend/src/services/ocrService.ts");

    pipeline.setMode("stall-status");
    const stalledStatus = await timed(() => service.processFileWithOCR(filePath, "pdf"));
    assertBounded(stalledStatus.result);
    assert.ok(
      stalledStatus.elapsedMs < TOTAL_TIMEOUT_MS * 3,
      `stalled status returned after ${stalledStatus.elapsedMs}ms`
    );
    assert.ok(stalledStatus.elapsedMs >= POLL_INTERVAL_MS, "did not poll before giving up");

    pipeline.setMode("stall-result");
    const stalledResult = await timed(() => service.processFileWithOCR(filePath, "pdf"));
    assertBounded(stalledResult.result);
    assert.ok(
      stalledResult.elapsedMs < TOTAL_TIMEOUT_MS * 3,
      `stalled result returned after ${stalledResult.elapsedMs}ms`
    );

    pipeline.setMode("stall-submit");
    const stalledSubmit = await timed(() => service.processFileWithOCR(filePath, "pdf"));
    assertBounded(stalledSubmit.result);
    assert.ok(
      stalledSubmit.elapsedMs < TOTAL_TIMEOUT_MS * 3,
      `stalled submission returned after ${stalledSubmit.elapsedMs}ms`
    );

    // A slow but responsive pipeline still succeeds inside the budget.
    pipeline.setMode("slow");
    const slow = await timed(() => service.processFileWithOCR(filePath, "pdf"));
    assert.equal(slow.result.success, true, slow.result.error);
    assert.equal(slow.result.text, "Q1. Define latency");

    pipeline.setMode("healthy");
    const healthy = await timed(() => service.processFileWithOCR(filePath, "pdf"));
    assert.equal(healthy.result.success, true, healthy.result.error);
    assert.equal(healthy.result.status, "success");
    assert.equal(healthy.result.retryable, undefined);

    pipeline.setMode("stall-status");
    const status = await timed(() => service.checkOCRStatus("batch-157"));
    assert.equal(status.result.status, "error");
    assert.match(status.result.error ?? "", /timed out/);
    assert.ok(
      status.elapsedMs < TOTAL_TIMEOUT_MS * 3,
      `stalled status check returned after ${status.elapsedMs}ms`
    );

    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      path.resolve(here, "../../packages/backend/src/services/ocrService.ts"),
      "utf8"
    );
    assertEveryPipelineCallIsBounded(source);
    assert.match(source, /remainingBudget\(deadline\)/);
    assert.match(source, /OCR_TOTAL_TIMEOUT_MS/);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await pipeline.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}
