import chokidar from "chokidar";
import fs from "fs/promises";
import path from "path";
import { getBloomsAnatomy, getQuestionPapersFromPdf } from "./geminiAi.js";
import json5 from "json5";
import { json } from "stream/consumers";
import pLimit from "p-limit";

// ========== GLOBAL VARIABLES ==========
// This is used to limit the number of concurrent tasks defaults are given but can be changed if parameters are passed
//limit is used to limit the number of concurrent requests to the LLM API
let limit = pLimit(30);
// fileLimit is used to limit the number of concurrent file processing tasks
let fileLimit = pLimit(80);

async function regexFilter(unsanitizedText) {
  const sanitizedText = unsanitizedText
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "")
    .replace(/<[^>]+\/?>/g, "")
    .replace(/```(?:json)?\n?/gi, "")
    .replace(/```/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[©®™µ]/g, "")
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "/")
    .replace(/[\u0000-\u001F]/g, "")
    .replace(/,\s*([\]}])/g, "$1");
  return sanitizedText;
}

async function generateBloomsAnatomyTxt(filePath: string) {
  //get all the file contents and apply regex filter to make sure the text is clean and safe for LLM to process
  let buffer = await fs.readFile(filePath, "utf-8");
  buffer = regexFilter(buffer);

  //get the question papers from the pdf using LLM
  let data = await getQuestionPapersFromPdf(buffer);
  if (typeof data !== "object") throw new Error("Invalid LLM response format");

  let results = {};
  // If the data has more than 10 courses, process them in parallel
  // If it has less than or equal to 10 courses, process them sequentially with a limit of 30 concurrent requests
  // This is to avoid hitting the LLM rate limits and to ensure we don't overload the system

  if (Object.keys(data).length > 10) {
    const entries = Object.entries(data);
    const refinedEntries = await Promise.all(
      entries.map(([course, questions]) =>
        limit(async () => {
          const refined = await getBloomsAnatomy(questions);
          return [course, refined[course]];
        })
      )
    );

    results = Object.fromEntries(refinedEntries);
  } else {
    const jsonifyeddata = json5.stringify(data);
    const refinedQuestions = await limit(() => getBloomsAnatomy(jsonifyeddata));
    return refinedQuestions;
  }

  return results;
}

async function processFile(filePath) {
  try {
    const cleanedPath = filePath.replace(/\\/g, "/");
    const segments = cleanedPath.split("/");

    if (!cleanedPath.endsWith(".txt")) {
      console.log("[SKIPPED - NOT .txt]", cleanedPath);

      return;
    }

    const bloomsTaxonomyQuestions = await generateBloomsAnatomyTxt(cleanedPath);

    let outputDir = path.join(
      "bloomsAnatomyFinal",
      segments[segments.length - 2]
    );
    const outputFile = path.join(outputDir, segments[segments.length - 1]);

    for (let course of Object.keys(bloomsTaxonomyQuestions)) {
      course = course.replace(/[<>:/\\|?*\x00-\x1F]/g, "");
      let dir = path.join("questionPapers", course);
      await fs.mkdir(dir, { recursive: true });
      dir = path.join(dir, segments[segments.length - 1]);

      bloomsTaxonomyQuestions[course] = json5.stringify(
        bloomsTaxonomyQuestions[course]
      );
      await fs.writeFile(dir, bloomsTaxonomyQuestions[course] + "\n");
    }
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(
      outputFile,
      json5.stringify(bloomsTaxonomyQuestions) + "\n"
    );
    console.log("[PROCESSED]", outputFile);
  } catch (err) {
    console.error("[ERROR processing file]", filePath, err.message);
  }
}
// let fileContent = "";
// async function mergeFiles() {
//   if (isProcessing || taskQueue.length === 0) return;
//   isProcessing = true;
//   const filepath = taskQueue.shift();
//   fileContent =
//     fileContent +
//     "\n" +
//     filepath.split("/").pop() +
//     "\n" +
//     (await fs.readFile(filepath));
//   if (taskQueue.length == 0) {
//     fs.writeFile("C:/Users/bobby/Downloads/temp2/skibidi.txt", fileContent);
//     console.log("program executed sucessfully");
//     isProcessing = false;
//   } else {
//     console.log("merged file" + filepath);
//     isProcessing = false;
//     mergeFiles();
//   }
// }
// ========== CHOKIDAR WATCHER ==========
chokidar
  .watch("C:/ocr_output - Copy", { ignoreInitial: false })
  .on("add", (filePath) => {
    fileLimit(() => processFile(filePath)); // Handles up to 10 in parallel
    // mergeFiles();
  });
