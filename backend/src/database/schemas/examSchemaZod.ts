import { z } from "../zodGlobal.js";
/*
  * Exam Zod Schema definition 
  *Transformed to mongoose schema using zod-to-mongoose in the (filename) in parent directory  --todo: update this comment with the filename when the file is created
  *validates the data before saving it to the database
  *Represents an exam entity including the exam metadeta,Linked Questions,Users which are assigned to this test,users responses to the exams
 */

export const examZodSchema = z.object({
  examTitle: z.string(),               // Name of the exam
  examType: z.enum(["mcq","theory"]),  //Type of exam format
  examFollowup: z.string(),            //Exam status displayed in the UI alongside the title of exam
  examMaxMarks: z.number(),            // Total marks for which the exam is evaluated out of
  examPassingPercentage: z.number(),   // Minimum percentage required to pass the exam
  examDegree: z.string(),              // Degree programme for which the exam is conducted
  examUsers: z.array(z.string()),      // arrays objectIds as string reffering to user model (userSchamaZod.ts)
  examQuestions: z.array(              // Array of question objects questions are uniquely stored in questionSchemaZod.ts and referenced here  
    z.object({
      questionId: z.string(),          // ObjectId as string
      marks: z.number(),               // Marks assigned to the question 
    })
  ),
  studentsResponse: z.array(           // Array of student responses to the exam questions (TODO: Make this an different schema as it will be used in userSchemaZod.ts too)
    z.object({
      question: z.string(),            //Foreign Key reffering to questionSchemaZod.ts
      userResponse: z.string(),        // Student's response to the question
      maximumMarks: z.number(),        //Maximum marks for the question
      allottedMarks: z.number(),       // Marks allotted to the student for the question
      feedback: z.string(),            // Feedback for the student's response given by the teacher agent 
    })
  ).optional(),
})

export type Exam= z.infer<typeof examZodSchema>