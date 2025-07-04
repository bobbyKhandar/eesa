"use server";
import nodemailer from "nodemailer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import fs from "fs";
import { error } from "console";
import { select } from "@heroui/theme";
import path from "path";
import { json } from "stream/consumers";
dotenv.config();
import xlsx from "xlsx";
import JSON5 from "json5";
import json5 from "json5";
// console.log(process.env.gemini_api_key);

const genAI = new GoogleGenerativeAI(process.env.gemini_api_key);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
});

async function postAnswers(studentanswer, email) {
  const prompt =
    "Evaluate student answers based on study level, mark allocation, and relevance. Each question specifies marks; answers must match in depth. For 2 marks, no length requirement; for 5+, expect explanation and elaboration. Depth should align with marks, with deductions for irrelevance. Provide constructive feedback on strengths and improvements. Output includes: Final Marks (adjusted based on depth, relevance, and length) and pointsWhichWereGood  which means which points were the strenghts of the students ,pointsStudentCanImproveOn are the points which the student is weak and should improve on both  pointsWhichWereGood and pointsStudentCanImproveOn should be (concise, second-person).output should be in Respond in JSON ,structure being {question:value,studentans:value,givenMarks:value,allotedmarks:value,pointsWhichWereGood:value,pointsStudentCanImproveOn:value)} your response should strictly be in JSON Format only  Apply rules fairly and consistently, using criticism to encourage growth." +
    JSON.stringify(studentanswer);
  const result = await model.generateContent(prompt);
  let jsonString = result.response.text().replace(/^```json\s*|\s*```$/g, "");
  const data = JSON.parse(jsonString);
  let finalPrompt = "";

  data.map((chunk) => {
    console.log(chunk);
    finalPrompt += `question:${chunk.question} \n (${chunk.allotedmarks} marks) \n your response ${chunk.studentans} \n  graded marks:${chunk.givenMarks} \n feedback on your answer:${chunk.feedback} \n \n \n`;
  });
  console.log(finalPrompt);
}
async function uploadsyllabus(path, marks) {
  var question5marks = Math.ceil(marks * 0.3);
  while (question5marks % 10 != 0) question5marks++;
  const question10marks = marks - question5marks;
  console.log(question5marks);
  console.log(question10marks);
  const result = await model.generateContent([
    {
      inlineData: {
        data: Buffer.from(fs.readFileSync(path)).toString("base64"),
        mimeType: "application/pdf",
      },
    },
    `you are given an syllabus for the exam you have to get the contents within it and give the potential questions which can be asked in an undergradugate examinations whith marking scheme being ${
      question5marks / 5
    } of the questions being 5 marks and ${
      question10marks / 10
    } of the questions being 10 marks it is strictly prohibited to respond with more then and less then the number of the questions given in the prompt, you should analyse which is the important sections of the syllabus and give students the questions and the biggest priority for you is to aviod Hallucination at all cost you shall not have any extra questions you should give response in json object format and you should just genrate questions nothing else no title no max marks no marking scheme no instructions just questions with the formate being questions: [ {"marks": "5_marks","question": "genrated question"}] `,
  ]);
  console.log(result);
  let jsonString = result.response.text().replace(/^```json\s*|\s*```$/g, "");
  const jsonrespomse = JSON.parse(jsonString);
  console.log(jsonrespomse);
}
export async function uploadsyllabusalt(base64e, marks) {
  console.log("starting...");
  try {
    var question5marks = Math.ceil(marks * 0.3);
    while (question5marks % 10 != 0) question5marks++;
    const question10marks = marks - question5marks;
    console.log(question5marks);
    console.log(question10marks);
    const result = await model.generateContent([
      {
        inlineData: {
          data: base64e,
          mimeType: "application/pdf",
        },
      },
      `you are given an syllabus for the exam in base64 format you have to get the contents within it and give the potential questions which can be asked in an undergradugate examinations whith marking scheme being ${
        question5marks / 5
      } of the questions being 5 marks and ${
        question10marks / 10
      } of the questions being 10 marks it is strictly prohibited to respond with more then and less then the number of the questions given in the prompt, you should analyse which is the important sections of the syllabus and give students the questions and the biggest priority for you is to aviod Hallucination at all cost you shall not have any extra questions you should give response in json object format and you should just genrate questions nothing else no title no max marks no marking scheme no instructions just questions with the formate being questions: [ {"marks": "5_marks","question": "genrated question"}] `,
    ]);
    console.log(result);
    let jsonString = result.response.text().replace(/^```json\s*|\s*```$/g, "");
    const jsonresponse = JSON.parse(jsonString);
    console.log(jsonresponse);

    return jsonresponse;
  } catch (error) {
    console.log(error);
  }
}

export async function refineSyllabus(data) {
  const prompt =
    "You have been given an syllabus which was converted from image to text you have to analyse the text and remove all the text contents which are not the actual syllabus it should start with topics and end with topics all else is supposed to be ignored including colleges name year batch page number Only the actual syllabus is to be looked upon You dont have permission to speak at all you shall only look at the text contents and do as the prompt says also there may be spelling mistakes or some spacing errors you have to keep in mind that too you must only respond refining the syllabus  the text content=" +
    data;
  console.log(prompt);
  const response = await model.generateContent(prompt);
  console.log(response.response.text());
  return response.response.text();
}

export async function refinePyqs(data) {
  const prompt =
    "You have been given an set of previously asked questions which was converted from image to text you have to analyse the text and remove all the text contents which are not the actual questions there would be multiple set of question papers so there are chances that an question is repeated you have to keep in mind how many times it is being repeated and at the end you have to give output in json format there maybe simmilar questions with diffrent wording but same overall question you should then join both the question and add both of the times asked and potentially rephrase the question in such a way that both of the questions are being asked the structire of the output is {'questions':[{'question':(the intended question),'timesAsked':(times it has been asked)}]} the questions are=" +
    data;

  const result = await model.generateContent(prompt);
  let jsonString = result.response.text().replace(/^```json\s*|\s*```$/g, "");
  const jsonresponse = JSON.parse(jsonString);
  console.log(jsonresponse);
  console.log(result);
  console.log(result.response);
  return jsonresponse;
}

async function mailToUser(response, email) {
  var transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.user_email,
      pass: process.env.user_password,
    },
  });

  var mailOptions = {
    from: process.env.user_email,
    to: email,
    subject: "Graded Marks Of user",
    text: response,
  };

  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.log(error);
    } else {
      console.log("Email sent: " + info.response);
    }
  });
}

console.log(process.env.user_email);
console.log(process.env.user_password);

export { postAnswers };

export async function getQuestionPapersFromPdf(data) {
  const prompt =
    `
You are given a block of raw OCR-extracted text from multiple concatenated exam papers. Each paper includes questions from a different course.

Your task:

1. Group questions by course.  
Each exam paper typically begins with a course name. The course name may appear in different ways, such as:
- Name of the Course: <CourseName>
- Or simply <CourseName> on its own line near the top  
This is usually followed by standard headers like:
- "K. J. Somaiya College of Engineering, Mumbai-77 (Autonomous College Affiliated to University of Mumbai)"
- "Total Marks", "Duration", "Instructions", etc.
When extracting course names, remove any department codes, course numbers, or formatting noise. For example:
- "COMP - IVAnalysis of Algorithum & Design" → "Analysis of Algorithm and Design"
- "ITVIIData Mining & Warehousing" → "Data Mining and Warehousing"

Use only the clean, human-readable name of the course as the key in the final JSON output.
Use these indicators to detect the beginning of each new course paper. If the course name is unclear, infer a temporary name based on the position or surrounding text.

2. Clean and classify questions:  
For each course, extract and refine the questions using the rules below:

a. If the question is complete and error-free → keep it as-is  
b. If it’s incomplete, broken, or garbled → rewrite or merge it with an adjacent question  
c. If it’s invalid (not a question or just noise) → discard it  
d. If it’s a follow-up to the previous question → merge both into a clean, grammatical question  

3. Apply the following formatting rules:

- One question per line  
- No extra whitespace or line breaks  
- Do not paraphrase unless necessary to clean or merge a question  
- Remove all:  
  - Brackets: {}, [], ()  
  - Commas  
  - Phrases like “Attempt any two of the following”  

Output format:  
Return ONLY a valid JSON object in this structure:

{
  "Course Name 1": ["Cleaned Question 1", "Cleaned Question 2"],
  "Course Name 2": ["Cleaned Question A", "Cleaned Question B"]
}

Do NOT include explanations, markdown, or extra text. Return ONLY a raw JSON object.

Example Input:

Name of the Course: Operating Systems  
K. J. Somaiya College of Engineering...  
1. Explain process scheduling.  
2. What is a race condition?  

Compiler Design  
K. J. Somaiya College of Engineering...  
1. Define lexical analysis.  
2. Write short notes on intermediate code generation.

give the Output simmalar to the given example you shall not add any more wrapper or anything else!:
Give me a valid JSON object. Do not include data: or any unquoted keys. Only output pure JSON starting and ending with curly braces.  
{
  "Operating Systems": [
    "Explain process scheduling",
    "What is a race condition"
  ],
  "Compiler Design": [
    "Define lexical analysis",
    "Write short notes on intermediate code generation"
  ]
}


Now process the following text:
` + data;

  const result = await model.generateContent(prompt);
  console.log("question paper response=");
  let jsonString = await result.response
    .text()
    .replace(/^```json\s*|\s*```$/g, "");
  let sanitizedResponse = jsonString
    // Remove HTML tags
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "")
    .replace(/<[^>]+\/?>/g, "")

    // Remove markdown fences
    .replace(/```(?:json)?\n?/gi, "")
    .replace(/```/g, "")

    // Normalize curly quotes to straight
    .replace(/[“”]/g, '"') // curly double quotes → straight
    .replace(/[‘’]/g, "'") // curly single quotes → straight

    // Normalize dashes, ellipsis, copyright junk
    .replace(/[–—]/g, "-") // en/em dash → hyphen
    .replace(/…/g, "...") // ellipsis
    .replace(/[©®™µ]/g, "") // trash symbols

    // Normalize slashes
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "/") // invalid \ → /

    // Remove control chars
    .replace(/[\u0000-\u001F]/g, "")

    // Strip trailing commas before ] or }
    .replace(/,\s*([\]}])/g, "$1")

    .trim();
  sanitizedResponse = `${sanitizedResponse}`;

  const jsonifyed = await json5.parse(sanitizedResponse);
  return jsonifyed;
}

export async function getBloomsAnatomy(data) {
  const prompt =
    `
Classify each question into one of the 6 Bloom's Taxonomy levels. Use ONLY the following levels, and assign exactly one per question:

1. Remember – recall facts, definitions, or concepts (e.g., define, list, identify).
2. Understand – explain ideas or concepts in your own words (e.g., describe, summarize).
3. Apply – use knowledge in new situations or solve problems (e.g., calculate, demonstrate, implement).
4. Analyze – break down concepts into parts and explore relationships (e.g., compare, differentiate, categorize).
5. Evaluate – make judgments or justify decisions (e.g., critique, recommend, assess).
6. Create – produce new or original work (e.g., design, develop, compose).

If a question is unclear, incomplete, or not a question, label it as:

{
  "question": "<original question>",
  "level": "Invalid",
  "reason": "Question is unclear or incomplete"
}

Return ONLY a raw JSON array of objects in the format:


  {
  "Course Name 1": [{
  "question 1": "<original question>",
  "level": "<Bloom's Level>"
  },{
  "question2": "<original question>",
  "level": "<Bloom's Level>"
  }],
  "Course Name 2": [{
  "question 1": "<original question>",
  "level": "<Bloom's Level>"
  },{
  "question2": "<original question>",
  "level": "<Bloom's Level>"
  }]
}

NO extra text. NO markdown. NO explanation. Just valid plain JSON.

Now classify the following questions:
` + data;
  console.log("prompt = ");
  console.log(prompt);
  const { response } = await model.generateContent(prompt);
  console.log("Blooms anatomy response=");
  console.log(response.text());
  const trimmedResponse = await response
    .text()

    // Remove HTML tags
    .replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "")
    .replace(/<[^>]+\/?>/g, "")

    // Remove markdown fences
    .replace(/```(?:json)?\n?/gi, "")
    .replace(/```/g, "")

    // Normalize curly quotes to straight
    .replace(/[“”]/g, '"') // curly double quotes → straight
    .replace(/[‘’]/g, "'") // curly single quotes → straight

    // Normalize dashes, ellipsis, copyright junk
    .replace(/[–—]/g, "-") // en/em dash → hyphen
    .replace(/…/g, "...") // ellipsis
    .replace(/[©®™µ]/g, "") // trash symbols

    // Escape unescaped double quotes inside values

    // Normalize slashes
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "/") // invalid \ → /

    // Remove control chars
    .replace(/[\u0000-\u001F]/g, "")

    // Strip trailing commas before ] or }
    .replace(/,\s*([\]}])/g, "$1")

    .trim();
  console.log(trimmedResponse);
  let jsonResponse = JSON5.parse(trimmedResponse);
  return jsonResponse;
}

export async function refineQuestions(data, subjectName) {
  const prompt =
    `you have been given a set of questions analyze and clean the them and expect grammatical and logical mistakes as the questions are converted image to text using OCR 
        there are four things you can feel while analyzing an question
  
        1)the question is complete and doesmt need change- dont edit anything,
        2)the question is incomplete and it does need change-complete or rewrite the question, check if the adjoining questions are an follow up merge it into one,
        3)the question is invalid and it is not supposed to be here-ignore the question,
        4)the question meant to be an followup to an adjoining question-merge the questions and add proper grammar,
  
        Use only one line for one question-no paraphrases,no line breaks  
  
        You have to give your output in array of strings format,The format being: [question1,question2....] 
        DO NOT GENERATE ANY QUESTION OUTSIDE the format  
        the subject name is:` +
    subjectName +
    " and the questions being" +
    data;
  let retryLimit = 0;

  while (retryLimit < 5) {
    try {
      const { response } = await model.generateContent(prompt);
      console.log("response==\n" + response.text());
      const trimmedResponse = await response
        .text()
        .replace(/^```[\w]*\s*|\s*```$/g, "");
      return trimmedResponse;
    } catch (error) {
      console.log("error" + error);
      prompt +=
        "\n YOU ARE GENERATING QUESTION OUTSIDE THE SCOPE OF GIVEN PROMPT CAUSING THE SERVER HANDLING YOU TO GIVE ERROR THE AMOUNT OF TIMES YOU SEE THIS MESSAGE IS THE AMOUNT OF TIME YOU HAVE GAVE ERROR DONT DO STUFF NOT PERMITED TO YOU !!!";
      retryLimit++;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
// const files = fs.readdirSync(
//   String.raw`C:\project\miniproject\bloomsAnatomy\\`
// );
// let map = new Map();
// let resultBloomjson = [];
// for (let file of files) {
//   const data = fs.readFileSync("bloomsAnatomy/" + file, "utf-8");

//   const lines = data.split("\n");

//   const parsed = lines
//     .map((line) => {
//       const match = line.match(/^(.*):([^:]+)$/);
//       console.log(match);
//       if (match) {
//         if (map.has(match[2].trim())) {
//           map.set(match[2].trim(), map.get(match[2].trim()) + 1);
//         } else {
//           map.set(match[2].trim(), 1);
//         }
//         resultBloomjson.push({
//           question: match[1].trim(),
//           type: match[2].trim(),
//           year: file.match(/20\d{2}/)[0],
//           subject: file
//             .replace(/20\d{2}/, "") // removes the year
//             .replace(/\.txt$/, "") // removes .txt at the end
//             .replace(/[-_]+$/, "") // optional: trims leftover dashes or underscores
//             .trim(),
//         });
//       }
//       // or handle invalid format
//     })
//     .filter(Boolean);

//   console.log(parsed);
// }
// console.log(map);
// console.log(resultBloomjson);
// const sheet = xlsx.utils.json_to_sheet(resultBloomjson);
// let xlsxsheet = xlsx.utils.book_new();
// xlsx.utils.book_append_sheet(xlsxsheet, sheet, "sheet");
// xlsx.writeFile(xlsxsheet, "C:/Users/bobby/Downloads/bloomsTaxamony.xlsx");
// refineQuestions(text, "Advanced Databases");

// const files = fs.readdirSync(
//   String.raw`C:\project\miniproject\tempFileStorer\\`
// );
// console.log(files);
// for (let file of files) {
//   const textContents = fs.readFileSync(file);
//   const questions = await JSON.parse(
//     await refineQuestions(textContents, path.basename(file))
//   );
//   let questionsText = "";
//   for (let question of questions) {
//     questionsText += question.question + ":" + question.type + "\n";
//   }
//   console.log(questionsText);
//   fs.writeFileSync(
//     String.raw`C:\project\miniproject\bloomsAnatomy\\` + path.basename(file),
//     questionsText
//   );
//   await sleep(20000);
// }
