import { describe, it } from "node:test";
import { runOcrDeadlineChecks } from "../ocrDeadlineCheck.ts";

describe("OCR pipeline deadline", () => {
  it("bounds stalled submission, status and result requests", async () => {
    await runOcrDeadlineChecks();
  });
});
