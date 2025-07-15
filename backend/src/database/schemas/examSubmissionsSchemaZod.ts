/*
*TODO: 
1)Figure out what this code does
2)Add Definitions to this file after V1.0 is done
*/
import {z} from "../zodGlobal.js"

export const examSubmissionsSchemaZod = z.object({
  examId: z.string(),
  total: z.number().default(0),
  allocated: z.number().default(0),
  score: z.number().default(0),
});

// export type Submissions= z.infer<typeof examSubmissionsSchemaZod>