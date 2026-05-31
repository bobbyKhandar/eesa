import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import dotenv from "dotenv";
import JSON5 from "json5";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

dotenv.config();

const BEDROCK_REGION = process.env.AWS_REGION || "us-east-1";
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0";
const TEXTRACT_HELPER = path.resolve(
  process.cwd(),
  "..",
  "ai_pipeline",
  "src",
  "textract_extract_text.py"
);

function usage() {
  console.log("Usage: node src/scripts/comparePdfDirectVsOcr.js <pdf1> [pdf2 ...]");
  console.log("Example: node src/scripts/comparePdfDirectVsOcr.js C:/project/miniproject/uploads/os23.pdf");
}

function assertInputs(pdfPaths) {
  if (!pdfPaths.length) {
    usage();
    process.exit(1);
  }
  if (!BEDROCK_MODEL_ID) {
    console.error("Missing Bedrock model id in environment.");
    process.exit(1);
  }

  if (!fs.existsSync(TEXTRACT_HELPER)) {
    console.error(`Textract helper not found: ${TEXTRACT_HELPER}`);
    process.exit(1);
  }

  const missing = pdfPaths.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.error("These files were not found:");
    missing.forEach((p) => console.error(`- ${p}`));
    process.exit(1);
  }
}

function stripCodeFence(text) {
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseJsonFlexible(text) {
  const cleaned = stripCodeFence(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([\]}])/g, "$1");
  return JSON5.parse(cleaned);
}

function getBedrockClient() {
  const config = {
    region: BEDROCK_REGION,
  };

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.awsaccessKeyId;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.awssecretAccessKey;
  const sessionToken = process.env.AWS_SESSION_TOKEN || process.env.awsSessionToken;

  if (accessKeyId && secretAccessKey) {
    config.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
  }

  return new BedrockRuntimeClient(config);
}

async function invokeBedrockJson({ prompt, pdfBase64 = "", text = "", maxTokens = 4096, temperature = 0.2 }) {
  const client = getBedrockClient();
  const userContent = [];

  if (pdfBase64) {
    userContent.push({
      type: "document",
      name: "input.pdf",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdfBase64,
      },
    });
  }

  if (text) {
    userContent.push({
      type: "text",
      text,
    });
  }

  userContent.push({
    type: "text",
    text: prompt,
  });

  const response = await client.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: maxTokens,
        temperature,
        messages: [
          {
            role: "user",
            content: userContent,
          },
        ],
      }),
    })
  );

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const raw = Array.isArray(responseBody.content)
    ? responseBody.content.map((block) => block?.text || "").join("")
    : responseBody.outputs?.[0]?.text || responseBody.completion || "";

  if (!raw.trim()) {
    throw new Error("Bedrock returned an empty response");
  }

  return parseJsonFlexible(raw);
}

async function parseQuestionsFromTextWithLlm(text) {
  const prompt = `You are given raw OCR text from one or more exam papers.
Extract and clean only valid questions grouped by course/subject.
Return only a valid JSON object in this shape:
{
  "Course Name": ["Question 1", "Question 2"]
}
Rules:
- Remove header/footer noise (college name, instructions, page numbers)
- Fix broken lines and obvious OCR artifacts
- Merge follow-up fragments into the nearest complete question
- Keep output concise and valid JSON only`;

  return invokeBedrockJson({ prompt, text, maxTokens: 4096, temperature: 0.2 });
}

function countQuestions(grouped) {
  if (!grouped || typeof grouped !== "object") {
    return { courseCount: 0, questionCount: 0 };
  }

  let courseCount = 0;
  let questionCount = 0;

  for (const value of Object.values(grouped)) {
    courseCount += 1;
    if (Array.isArray(value)) {
      questionCount += value.length;
    }
  }

  return { courseCount, questionCount };
}

function summarizeText(text) {
  if (!text) {
    return { chars: 0, words: 0 };
  }
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { chars: text.length, words };
}

async function runTextract(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("python", [TEXTRACT_HELPER, filePath], {
      cwd: path.resolve(process.cwd(), "..", "ai_pipeline"),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      reject(error);
    });

    proc.on("close", (code) => {
      try {
        const payload = JSON.parse(stdout.trim());
        if (code !== 0 || !payload?.success) {
          const helperError = payload?.error || stderr || `Textract helper failed with code ${code}`;
          reject(new Error(helperError));
          return;
        }
        resolve(payload);
      } catch {
        const output = stdout || stderr || "No output from Textract helper";
        reject(new Error(`Invalid Textract helper output: ${output}`));
      }
    });
  });
}

async function runTextractThenLlm(filePath) {
  const textractStart = Date.now();
  const textract = await runTextract(filePath);
  const extractedText = textract.text || "";

  if (!extractedText.trim()) {
    throw new Error("Textract returned empty text");
  }

  const llmStart = Date.now();
  const grouped = await parseQuestionsFromTextWithLlm(extractedText);

  return {
    textractJobId: textract.textract_job_id,
    textractMs: Date.now() - textractStart,
    llmMs: Date.now() - llmStart,
    totalMs: Date.now() - textractStart,
    ocrTextStats: summarizeText(extractedText),
    lineCount: textract.line_count || 0,
    pageCount: textract.page_count || 0,
    stagingS3Key: textract.s3_key || "",
    grouped,
    groupedStats: countQuestions(grouped),
  };
}

async function runDirectPdfToLlm(filePath) {
  const start = Date.now();
  const pdfBase64 = (await fsp.readFile(filePath)).toString("base64");

  const prompt = `You are given a PDF exam paper document.\nExtract all questions grouped by course/subject and clean OCR-like artifacts.\nReturn only a valid JSON object with this shape:\n{\n  "Course Name": ["Question 1", "Question 2"]\n}\nRules:\n- Keep only actual questions\n- Merge broken lines if required\n- Remove instructions and non-question noise\n- No markdown, no explanation, JSON only`;

  const grouped = await invokeBedrockJson({
    prompt,
    pdfBase64,
    maxTokens: 4096,
    temperature: 0.2,
  });

  return {
    llmMs: Date.now() - start,
    grouped,
    groupedStats: countQuestions(grouped),
    rawPreview: JSON.stringify(grouped).slice(0, 300),
  };
}

function printComparison(filePath, direct, textract) {
  const deltaQuestion = textract.groupedStats.questionCount - direct.groupedStats.questionCount;
  const deltaCourse = textract.groupedStats.courseCount - direct.groupedStats.courseCount;

  console.log("\n====================================================");
  console.log(`File: ${filePath}`);
  console.log("----------------------------------------------------");
  console.log("Direct PDF -> Bedrock");
  console.log(`- Bedrock time: ${direct.llmMs} ms`);
  console.log(`- Courses: ${direct.groupedStats.courseCount}`);
  console.log(`- Questions: ${direct.groupedStats.questionCount}`);
  console.log("Textract -> Bedrock");
  console.log(`- Textract job: ${textract.textractJobId}`);
  console.log(`- Textract time: ${textract.textractMs} ms`);
  console.log(`- Bedrock time: ${textract.llmMs} ms`);
  console.log(`- End-to-end: ${textract.totalMs} ms`);
  console.log(`- OCR chars: ${textract.ocrTextStats.chars}`);
  console.log(`- OCR words: ${textract.ocrTextStats.words}`);
  console.log(`- OCR lines: ${textract.lineCount}`);
  console.log(`- OCR pages: ${textract.pageCount}`);
  console.log(`- Courses: ${textract.groupedStats.courseCount}`);
  console.log(`- Questions: ${textract.groupedStats.questionCount}`);
  console.log("Delta (Textract->LLM - Direct->LLM)");
  console.log(`- Course delta: ${deltaCourse}`);
  console.log(`- Question delta: ${deltaQuestion}`);
  console.log("====================================================");
}

async function main() {
  const pdfPaths = process.argv.slice(2).map((p) => p.replace(/\\\\/g, "/"));
  assertInputs(pdfPaths);

  const report = {
    createdAt: new Date().toISOString(),
    mode: "pdf_vs_textract_then_bedrock",
    files: [],
  };

  for (const filePath of pdfPaths) {
    console.log(`\nRunning comparison for ${filePath}`);
    try {
      const [direct, textract] = await Promise.all([
        runDirectPdfToLlm(filePath),
        runTextractThenLlm(filePath),
      ]);

      printComparison(filePath, direct, textract);

      report.files.push({
        filePath,
        status: "success",
        direct,
        textract,
      });
    } catch (error) {
      console.error(`Comparison failed for ${filePath}:`, error.message || error);
      report.files.push({
        filePath,
        status: "failed",
        error: error.message || String(error),
      });
    }
  }

  const outDir = path.resolve(process.cwd(), "..", "outputs", "ab_tests");
  await fsp.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `pdf_bedrock_vs_textract_${Date.now()}.json`);
  await fsp.writeFile(outFile, JSON.stringify(report, null, 2), "utf-8");

  console.log(`\nSaved comparison report to: ${outFile}`);
}

main().catch((error) => {
  console.error("Fatal error:", error.message || error);
  process.exit(1);
});
