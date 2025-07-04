import { pdf } from "pdf-to-img";
import tesseract from "node-tesseract-ocr";
import _ from "lodash";
import { getQuestionPapersFromPdf } from "./geminiAi.js";
import fs from "fs";
import FastGlob from "fast-glob";
const config = {
  lang: "eng",
  oem: 1,
  psm: 3,
};
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function getTextContentsFromPdf(pdfpath) {
  console.log("hi");
  const document = await pdf(pdfpath, { scale: 3 });
  let textContents = "";
  for (let i = 0; i < document.length; i++) {
    const buffer = await document.getPage(i + 1);
    await tesseract
      .recognize(buffer, config)
      .then((text) => {
        textContents += text;
      })
      .catch((error) => {
        console.log(error.message);
      });
  }

  return textContents;
}

async function getContentsFromPdf(questionPaperPath, metadataPaper) {
  let questionDataBuffer = await getTextContentsFromPdf(questionPaperPath);
  questionDataBuffer = questionDataBuffer
    .replace(/\\/g, "\\\\")
    .replace(/[\u0000-\u001F]/g, "")
    .replace(/“|”/g, "")
    .replace(/‘|’/g, "")
    .replace(/\"/, "")
    .replace(/([\[{,]\s*".+?"\s*:\s*\["[^"]*)"(.*?)"([^"]*\])/, '$1\\"$2\\"$3')
    .replace(/\s+/g, " ");
  console.log(questionDataBuffer);
  const fsPath = String.raw`C:\project\miniproject\tempFileStorer\test1.txt`;
  fs.writeFileSync(fsPath, questionDataBuffer, function (err) {
    if (err) throw err;
    console.log("Saved!");
  });
  const questionPapers = await getQuestionPapersFromPdf(questionDataBuffer);
  console.log(questionPapers);
  questionPapers.forEach((questionPaper) => {
    const questionPaperName = Object.keys(questionPaper);
    const Fp =
      String.raw`C:\Users\bobby\Downloads\\` +
      questionPaperName[0].replace(/\\/g, "") +
      metadataPaper +
      ".txt";
    let Questions = "";
    questionPaper[questionPaperName].forEach((question) => {
      Questions += `${question}\n`;
    });
    let sanatisedQuestions = "" + Questions.replace(/[<>:"/\\|?*]/g, "");
    fs.writeFileSync(Fp, sanatisedQuestions);
  });
}
let actualFolder = String.raw`C:/Users/bobby/OneDrive/Documents/Past Question Papers`;

async function readPyqFolder(folder) {
  const entries = FastGlob.sync(`${folder}/**/*.pdf`);
  for (const questionpaper of entries) {
    const questionPaperContents = await getTextContentsFromPdf(questionpaper);

    fs.writeFileSync(
      `C:/project/miniproject/previousYearPapersUnoptimized/${questionpaper
        .match(/Past\s*Question\s*Papers\/(.+)$/)[1]
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
        .trim()}`,
      questionPaperContents
    );
  }
}

