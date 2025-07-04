//used llm to generate code for this file
import { GoogleGenerativeAI } from "@google/generative-ai";
import FastGlob from "fast-glob";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import textract from "textract";
import Tesseract from "tesseract.js";

// --- CONFIGURATION ---
dotenv.config(); // Load environment variables from .env file

// IMPORTANT: Set the path to the folder containing your job description files.
const INPUT_FOLDER = String.raw`C:/Users/bobby/Downloads/Job Description Of Various Companies 24-25-20250702T134715Z-1-001/Job Description Of Various Companies 24-25`;

// Folder where the final JSON files will be saved.
const OUTPUT_FOLDER = path.join(process.cwd(), "job_outputs_json");
console.log(process.env.gemini_api_key);
// --- AI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.gemini_api_key);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash", // Using 1.5-flash, it's great for this kind of task
});

// =================================================================================
// HELPER FUNCTIONS
// =================================================================================

/**
 * Extracts text from a document file (pdf, docx, etc.).
 */
function extractTextFromDocument(filePath) {
  return new Promise((resolve, reject) => {
    textract.fromFileWithPath(
      filePath,
      { preserveLineBreaks: true },
      (error, text) => {
        if (error) return reject(error);
        resolve(text);
      }
    );
  });
}

/**
 * Extracts text from an image file using OCR.
 */
async function extractTextFromImage(filePath) {
  console.log(
    `  -> Using OCR for image: ${path.basename(
      filePath
    )}... (this may take a moment)`
  );
  const {
    data: { text },
  } = await Tesseract.recognize(filePath, "eng");
  return text;
}

/**
 * Determines the file type and calls the appropriate text extraction function.
 * @param {string} filePath - The full path to the file.
 * @returns {Promise<string|null>} Extracted text or null if unsupported.
 */
async function getTextFromFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".pdf":
    case ".docx":
    case ".pptx":
    case ".xlsx":
    case ".doc":
    case ".odt":
    case ".rtf":
      return await extractTextFromDocument(filePath);
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".bmp":
    case ".gif":
      return await extractTextFromImage(filePath);
    default:
      console.log(`  -> Skipping unsupported file type: ${extension}`);
      return null;
  }
}

/**
 * Sends extracted text to Gemini AI to get structured data.
 * @param {string} documentText - The text content of the job description.
 * @returns {Promise<object>} A promise that resolves with the structured JSON data.
 */
async function getStructuredDataFromAI(documentText) {
  const prompt = `
You are an expert HR analyst specializing in extracting structured information from job descriptions.
Analyze the following job description text and extract the specified fields into a clean JSON object.
If a field is not mentioned or cannot be found, use null as its value.

JOB DESCRIPTION TEXT:
---
${documentText}
---

EXTRACT THE FOLLOWING FIELDS INTO A JSON OBJECT:
1.  jobTitle: The title of the job.
2.  companyName: The name of the company hiring.
3.  jobLocation: City, State, or "Remote".
4.  jobDescription: A brief summary of the role.
5.  requiredSkills: An array of key skills and technologies required.
6.  preferredQualifications: An array of qualifications that are a plus.
7.  salaryRange: The salary or compensation details, e.g., "$100,000 - $120,000" or "Competitive".
8.  jobType: e.g., "Full-time", "Part-time", "Contract", "Internship".
9.  gpaCriteria: Any specific GPA requirement, e.g., "3.0/4.0".
10. experienceLevel: e.g., "Entry-level", "Mid-level", "Senior-level".
11. applicationDeadline: The final date to apply.
12. benefitsOffered: An array of benefits mentioned (e.g., "Health insurance", "401k").
13. workModel: e.g., "Remote", "On-site", "Hybrid".

Provide ONLY the JSON object in your response.
`;

  const result = await model.generateContent(prompt);
  const responseText = await result.response.text();

  // Clean the response to ensure it's valid JSON
  const jsonString = responseText
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
  return JSON.parse(jsonString);
}

// =================================================================================
// MAIN EXECUTION LOGIC
// =================================================================================

async function main() {
  console.log("--- Starting Job Description Processing ---");
  try {
    // 1. Ensure output directory exists
    await fs.mkdir(OUTPUT_FOLDER, { recursive: true });

    // 2. Find all files in the input folder and its subdirectories
    const filePaths = await FastGlob(`${INPUT_FOLDER}/**/*.*`, {
      // Note: FastGlob uses forward slashes even on Windows
      cwd: path.dirname(INPUT_FOLDER),
      absolute: true,
    });

    if (filePaths.length === 0) {
      console.log(`No files found in '${INPUT_FOLDER}'. Exiting.`);
      return;
    }

    console.log(`Found ${filePaths.length} documents to process.\n`);

    // 3. Process each file one by one
    for (const filePath of filePaths) {
      console.log(`[Processing]: ${path.basename(filePath)}`);
      try {
        // Step A: Extract raw text from the document
        const rawText = await getTextFromFile(filePath);

        if (!rawText || rawText.trim() === "") {
          console.log(`  -> No text extracted. Skipping.`);
          continue;
        }
        console.log(
          `  -> Text extracted successfully (${rawText.length} characters).`
        );

        // Step B: Send text to AI for structuring
        console.log(`  -> Sending to AI for analysis...`);
        const structuredData = await getStructuredDataFromAI(rawText);

        // Step C: Save the structured JSON output
        const outputFileName = `${path.parse(filePath).name}.json`;
        const outputFilePath = path.join(OUTPUT_FOLDER, outputFileName);
        await fs.writeFile(
          outputFilePath,
          JSON.stringify(structuredData, null, 2)
        ); // a '2' for pretty-printing the JSON

        console.log(
          `  -> SUCCESS: Saved structured data to ${outputFileName}\n`
        );
      } catch (error) {
        console.error(
          `  -> ERROR processing ${path.basename(filePath)}: ${error.message}\n`
        );
        // Continue to the next file
      }
    }
    console.log("--- All files processed! ---");
    console.log(`Check the '${OUTPUT_FOLDER}' directory for your JSON files.`);
  } catch (error) {
    console.error("A critical error occurred:", error);
  }
}

// Run the main function
main();
