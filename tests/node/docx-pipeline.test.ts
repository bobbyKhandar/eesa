import { describe, it } from "node:test";
import { runDocxHandlerTests } from "./docxPipelineCheck.ts";

describe("DOCX exam uploads", () => {
  it("extracts DOCX text instead of sending the file to the PDF OCR handler", () => {
    runDocxHandlerTests();
  });
});
