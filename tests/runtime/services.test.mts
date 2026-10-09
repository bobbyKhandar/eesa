import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { S3Client } from "@aws-sdk/client-s3";
import mongoose from "mongoose";

test("OCR uses the existing analysis stages and releases polling after failure", async (t) => {
  const { ec2OcrClient } = await import("../../packages/backend/src/services/ec2OcrClient.ts");
  const { processExamWithEC2OCR } = await import("../../packages/backend/src/services/examOcrService.ts");
  t.mock.method(ec2OcrClient, "healthCheck", async () => ({ status: "healthy" }));
  t.mock.method(ec2OcrClient, "submitBatch", async () => ({ batch_id: "batch-1", success: true }));
  const wait = t.mock.method(ec2OcrClient, "waitForBatch", async () => ({
    results: [{ status: "success", file_path: "/paper.pdf", extracted_text: "Define inertia", confidence: 0.9, processing_time: 2 }],
  }));
  const clear = t.mock.method(globalThis, "clearInterval");
  const responses = [
    [{ questionNumber: "1", questionText: "Define inertia", marks: 5, questionType: "Short" }],
    [{ questionNumber: "1", questionText: "Define inertia", marks: 5, bloomLevel: "Recall", keywords: [] }],
    { overallAssessment: "Recall focused", recommendations: [], strengths: [], improvements: [] },
  ];
  const prompts: string[] = [];
  const model = new GoogleGenerativeAI("").getGenerativeModel({ model: "test" });
  t.mock.method(Object.getPrototypeOf(model), "generateContent", async (prompt: string) => {
    prompts.push(prompt);
    return { response: { text: () => JSON.stringify(responses.shift()) } };
  });
  const request = { pdfPaths: ["/paper.pdf"], subjectName: "Physics", year: "2026", semester: "S1", examType: "main" as const };
  const result = await processExamWithEC2OCR(request);
  assert.equal(result.success, true);
  assert.equal(result.analysis.questions[0].questionText, "Define inertia");
  assert.equal(result.analysis.bloomDistribution.Recall, 100);
  assert.equal(result.analysis.insights.overallAssessment, "Recall focused");
  assert.equal(prompts.length, 3);
  assert.ok(prompts[0].includes("Define inertia"));
  assert.ok(prompts.every(prompt => prompt.includes("Physics")));
  assert.equal(clear.mock.callCount(), 1);
  wait.mock.mockImplementation(async () => { throw new Error("OCR timeout"); });
  await assert.rejects(processExamWithEC2OCR(request), /OCR timeout/);
  assert.equal(clear.mock.callCount(), 2, "a failed batch must also stop polling");
});

test("restore reports partial insertion and counts documents returned by Mongoose", async (t) => {
  const originalUri = process.env.mongodb_url;
  process.env.mongodb_url = "mongodb://127.0.0.1/unused-test";
  t.after(() => {
    if (originalUri === undefined) delete process.env.mongodb_url;
    else process.env.mongodb_url = originalUri;
  });
  const { getManagedCollections } = await import("../../packages/backend/src/database/managedCollectionModels.ts");
  const { restoreBackup } = await import("../../packages/backend/src/services/databaseBackupService.ts");
  const collections = getManagedCollections();
  t.mock.method(mongoose, "connect", async () => mongoose);
  t.mock.method(S3Client.prototype, "send", async () => ({
    Body: { transformToString: async () => JSON.stringify({ Prompt: [{ questionText: "valid" }, { questionText: "invalid" }] }) },
  }));
  for (const { model } of collections) {
    t.mock.method(model, "deleteMany", async () => ({ deletedCount: 0 }));
    t.mock.method(model, "insertMany", async () => [{ questionText: "valid" }]);
  }
  const result = await restoreBackup("backup_test");
  assert.equal(result.collectionCounts.Prompt, 1);
  assert.equal(result.success, false);
  assert.match(result.errors.Prompt, /1 of 2/);
});
