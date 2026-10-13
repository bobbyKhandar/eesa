import { describe, it } from "node:test";
import { runOcrFailedPageChecks } from "../ocrPageOutcomeCheck.ts";

describe("OCR failed pages", () => {
  it("surfaces lost pages and fails only when every page failed", () => {
    runOcrFailedPageChecks();
  });
});
