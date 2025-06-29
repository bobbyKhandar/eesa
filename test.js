import chokidar from "chokidar";
import fs from "fs/promises";
import path from "path";
import { getBloomsAnatomy, getQuestionPapersFromPdf } from "./geminiAi.js";
import json5 from "json5";
import { json } from "stream/consumers";
import pLimit from "p-limit";
const limit = pLimit(30); // For getBloomsAnatomy
const fileLimit = pLimit(80); // For processing files in parallel

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Your OG function, untouched
async function generateBloomsAnatomyTxt(filePath) {
  let buffer = await fs.readFile(filePath, "utf-8");
  buffer = buffer
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

  let data = await getQuestionPapersFromPdf(buffer);

  if (typeof data !== "object") throw new Error("Invalid LLM response format");

  let results = {};
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
