"use server"
import nodemailer from "nodemailer"
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();
console.log(process.env.gemini_api_key)

async function postAnswers(studentanswer,email) {

const genAI = new GoogleGenerativeAI(process.env.gemini_api_key);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = 'Evaluate student answers based on study level, mark allocation, and relevance. Each question specifies marks; answers must match in depth. For 2 marks, no length requirement; for 5+, expect explanation and elaboration. Depth should align with marks, with deductions for irrelevance. Provide constructive feedback on strengths and improvements. Output includes: Final Marks (adjusted based on depth, relevance, and length) and Feedback (concise, second-person, highlighting strengths and areas to improve).output should be in Respond in JSON ,structure being {question:value,studentans:value,marks:value,allotedmarks:value,feedback:value)} your response should strictly be in JSON Format only  Apply rules fairly and consistently, using criticism to encourage growth.'+JSON.stringify(studentanswer);

    const result = await model.generateContent(prompt);

    let jsonString = result.response.text().replace(/^```json\s*|\s*```$/g, "");
    // const airesponse=JSON.parse(result.response.text())
    //console.log(jsonString)
    const data = JSON.parse(jsonString);
    let finalPrompt="";
    data.map((chunk)=>{
      console.log("question="+chunk.question)
      finalPrompt+=`question:${chunk.question} (${chunk.marks} marks) \n alloted marks:${chunk.allotedmarks} \n feedback on your answer:${chunk.feedback}\n \n \n`;
    })
      console.log(finalPrompt)
    mailToUser(finalPrompt,email)
}
async function mailToUser(response,email) {

    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.user_email,
          pass: process.env.user_password
        }
      });
      
      var mailOptions = {
        from: process.env.user_email,
        to: email,
        subject: 'Graded Marks Of user',
        text: response
      };
      
      transporter.sendMail(mailOptions, function(error, info){
        if (error) {
          console.log(error);
        } else {
          console.log('Email sent: ' + info.response);
        }
      });
}


console.log(process.env.user_email)
console.log(process.env.user_password)

export {postAnswers};
postAnswers("1+1=  ans:2","bobby.k@somaiya.edu ")

