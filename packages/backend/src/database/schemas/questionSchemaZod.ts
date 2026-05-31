/*
*TODO: Add complete definitions to this file after V1.0 is done
*/

import { z } from "../zodGlobal";

export const questionsZodSchema = z.object({
  // The question itself, required field
  text: z.string(),

  /*
    The correct answer to the question 
    for mcq questions, this will be the option that is correct
    for theory questions, this will be the answer to the question which will be compared with the student's answer using LLM, comparing the meaning behind both answers 
    optional field, if the question is not MCQ then the value is "NOT PRESENT"
  */
  answer: z.string().default("NOT PRESENT"),

  // Array of options for MCQ if the question is NOT MCQ then the array is empty
  options: z.array(z.string()).default([]),

  // mcq or theory
  type: z.enum(["mcq", "theory"]),

  // Bloom's taxonomy level only accepted values are remember, understand, apply, analyze, evaluate, create
  // bloomsTaxonomyLevel: z.enum([
  //   "remember",
  //   "understand",
  //   "apply",
  //   "analyze",
  //   "evaluate",
  //   "create",
  // ]),
});

export type Question= z.infer<typeof questionsZodSchema>