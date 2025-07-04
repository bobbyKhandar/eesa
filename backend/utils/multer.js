import {
  uploadsyllabusalt,
  refineSyllabus,
  refinePyqs,
  getQuestionPapersFromPdf,
} from "../services/geminiAi.js";
import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import pdfParse from "pdf-parse";

import { createSubject, getSubjects } from "../../db.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "500mb" }));
const port = 8080;
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });
app.post("/upload", upload.single("file"), (req, res) => {
  res.send({ response: "File uploaded successfully" });
  console.log(req.file.path);
});
app.post(
  "/create_Subject",
  upload.fields([
    { name: "subjectSyllabus", maxCount: 1 },
    { name: "subjectPyq", maxCount: 1 },
    // { name: "subjectImg", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      let syllabusText = "";
      let previousYearQuestions = "";
      let previousYearQuestionsjson;
      let { subjectName, subjectDescription, subjectDegree, maxMarks } =
        req.body;

      console.log(subjectDegree);
      console.log(subjectDescription);
      console.log(subjectName);
      const subjectSyllabusPath = req.files["subjectSyllabus"][0].path;
      const subjectPyqPath = req.files["subjectPyq"][0].path;
      // const subjectImgPath = req.files["subjectImg"][0].path;
      console.log(subjectSyllabusPath);
      console.log(subjectPyqPath);
      const dataBuffer = await fs.readFileSync(subjectSyllabusPath);
      const pdfData = await pdfParse(dataBuffer);
      // const imageBuffer = await fs.readFileSync(subjectImgPath);
      const pyqdataBuffer = await fs.readFileSync(subjectPyqPath);
      const pyqData = await pdfParse(pyqdataBuffer);

      if (pdfData.text.trim().length > 0) {
        console.log("This is a text-based PDF.");
        syllabusText = pdfData.text;
      } else {
        console.log("This is an image-based PDF.");
        syllabusText = await getTextContentsFromPdf(subjectSyllabusPath);
        syllabusText = await refineSyllabus(syllabusText);
      }

      // Extract previous year questions
      if (pyqData.text.trim().length > 0) {
        console.log("This is a text-based PDF.");
        previousYearQuestions = pyqData.text;
      } else {
        console.log("This is an image-based PDF.");
        previousYearQuestions = await getTextContentsFromPdf(subjectPyqPath);
        previousYearQuestionsjson = await refinePyqs(previousYearQuestions);
      }

      await createSubject(
        subjectName,
        subjectDescription,
        subjectDegree,
        maxMarks,
        "bobby.k@somaiya.edu",
        previousYearQuestionsjson,
        syllabusText
        //imageBuffer
      );

      res.send({ success: true, message: "Exam created successfully" });
    } catch (error) {
      console.error("Error creating exam:", error);
      res
        .status(500)
        .send({ success: false, message: "Internal Server Error" });
    }
  }
);

app.post("/upload-gemini", async (req, res) => {
  const { file, marks } = req.body;

  const questions = await uploadsyllabusalt(file, marks);
  res.send({ response: questions });
});
app.post("/getSubjects", async (req, res) => {
  const { email } = req.body;
  const subjects = await getSubjects(email);
  console.log("subjects=");
  console.log(subjects);
  res.send({ subjects: subjects });
});

// app.listen(port, () => {
//   console.log(`Server is running on port ${port}`);
// });


// // async function getBloomsAnatomy(filePaths) {
// //   const subjectquestions = fs.readFileSync(
// //     String.raw`C:\project\miniproject\tempFileStorer\Web Programming-Ijune-2019.txt`
// //   );
// // }
// for (let index = 0; index < filePaths.length; index++) {
//   const path = filePaths[index];
//   await getContentsFromPdf(path, fileYears[index]);
//   await sleep(20000);
// }
// console.log("HI?");
// let Questions = "wqdqwd";
// console.log(typeof Questions);
