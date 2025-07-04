// used llm to generate code for this file
// =================================================================================

import { GoogleGenerativeAI } from "@google/generative-ai";
import FastGlob from "fast-glob";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

// --- CONFIGURATION ---
dotenv.config();

// The folder where your individual job JSON files are located.
const INPUT_JSON_FOLDER = "C:/project/miniproject/deprecated/job_outputs_json";

// The name of the final aggregated skills report file.
const OUTPUT_AGGREGATE_FILE = path.join(process.cwd(), "skills_report.json");

// --- AI SETUP ---
const genAI = new GoogleGenerativeAI(process.env.gemini_api_key);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

/**
 * Reads all .json files in a directory and aggregates the 'requiredSkills' arrays.
 * @param {string} folderPath - Path to the folder containing JSON files.
 * @returns {Promise<string[]>} A flat array of all skills, including duplicates.
 */
async function aggregateSkillsFromFiles(folderPath) {
  const jsonFiles = await FastGlob(`${folderPath}/**/*.json`);
  console.log(`Found ${jsonFiles.length} JSON files to analyze.`);

  let allSkills = [];
  for (const file of jsonFiles) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const data = JSON.parse(content);
      if (data && Array.isArray(data.requiredSkills)) {
        allSkills.push(...data.requiredSkills);
      }
    } catch (error) {
      console.warn(
        `  -> Warning: Could not read or parse ${path.basename(
          file
        )}. Skipping.`
      );
    }
  }
  return allSkills;
}

/**
 * Uses Gemini AI to group a list of skills into canonical categories.
 * @param {string[]} uniqueSkills - An array of unique skill strings.
 * @returns {Promise<object>} An object where keys are canonical skill names and values are arrays of original skill names.
 */
async function groupSkillsWithAI(uniqueSkills) {
  console.log(
    `Sending ${uniqueSkills.length} unique skills to AI for grouping...`
  );

  const prompt = `
You are a senior tech recruiter and data analyst. Your task is to analyze a list of technical and soft skills from various job descriptions and group them into canonical categories.

For example, if you see "Node.js", "NodeJS", and "Node", you should group them all under a single canonical key like "Node.js". Similarly, "ML" and "Machine Learning" should be grouped under "Machine Learning".

Here is the list of raw skills as a JSON array:
${JSON.stringify(uniqueSkills, null, 2)}

Please return a single JSON object where:
- The **keys** are the clean, canonical names of the skill categories.
- The **values** are arrays containing all the original raw skill names from the input list that belong to that category.

Example of desired output format:
{
  "JavaScript": ["JS", "Javascript", "ES6"],
  "React": ["React.js", "React"],
  "Python": ["Python"],
  "Project Management Tools": ["JIRA", "Trello", "Asana"],
  "AWS": ["Amazon Web Services", "AWS"]
}

Ensure every skill from the input list is placed into exactly one category in the output. Provide ONLY the JSON object in your response, without any extra text or markdown formatting.
`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  const jsonString = responseText
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(jsonString);
}

/**
 * Counts occurrences of all skills and organizes them based on the AI grouping.
 * @param {object} groupedSkills - The AI-generated grouping.
 * @param {string[]} allSkillsWithDuplicates - The original flat list of all skills.
 * @returns {object} The final report object.
 */
function generateFinalReport(groupedSkills, allSkillsWithDuplicates) {
  const finalReport = {};

  // First, get a simple frequency count of every raw skill.
  const rawSkillCounts = allSkillsWithDuplicates.reduce((acc, skill) => {
    acc[skill] = (acc[skill] || 0) + 1;
    return acc;
  }, {});

  // Now, build the report using the AI's grouping.
  for (const [canonicalName, variations] of Object.entries(groupedSkills)) {
    let totalCount = 0;
    const sourceBreakdown = {};

    for (const variation of variations) {
      const count = rawSkillCounts[variation] || 0;
      if (count > 0) {
        totalCount += count;
        sourceBreakdown[variation] = count;
      }
    }

    if (totalCount > 0) {
      finalReport[canonicalName] = {
        totalCount: totalCount,
        variations: sourceBreakdown,
      };
    }
  }

  // Sort the final report by totalCount in descending order
  const sortedReport = Object.entries(finalReport)
    .sort(([, a], [, b]) => b.totalCount - a.totalCount)
    .reduce((r, [k, v]) => ({ ...r, [k]: v }), {});

  return sortedReport;
}

// --- MAIN EXECUTION ---
async function main() {
  console.log("--- Starting Skill Analysis and Aggregation ---");

  try {
    // 1. Aggregate all skills from the JSON files
    const allSkillsWithDuplicates = await aggregateSkillsFromFiles(
      INPUT_JSON_FOLDER
    );
    if (allSkillsWithDuplicates.length === 0) {
      console.log("No skills found in any JSON files. Exiting.");
      return;
    }
    console.log(
      `Aggregated a total of ${allSkillsWithDuplicates.length} skill mentions.`
    );

    // 2. Get a unique list to send to the AI
    const uniqueSkills = [...new Set(allSkillsWithDuplicates)];

    // 3. Use AI to group the unique skills
    const groupedSkills = await groupSkillsWithAI(uniqueSkills);
    console.log("AI has successfully grouped the skills.");

    // 4. Generate the final, counted, and sorted report
    const finalReport = generateFinalReport(
      groupedSkills,
      allSkillsWithDuplicates
    );
    console.log("Final report generated and sorted.");

    // 5. Save the final report to a file
    await fs.writeFile(
      OUTPUT_AGGREGATE_FILE,
      JSON.stringify(finalReport, null, 2)
    );
    console.log(`\n--- SUCCESS! ---`);
    console.log(
      `Analysis complete. The aggregated report has been saved to:\n${OUTPUT_AGGREGATE_FILE}`
    );
  } catch (error) {
    console.error("\n--- An error occurred during the process ---");
    console.error(error);
  }
}

main();
