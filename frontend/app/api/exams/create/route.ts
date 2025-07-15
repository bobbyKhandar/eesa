import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import {createExam} from "@/backend/dist/database/db"


export async function POST(req: Request) {

// Ensure the request is authenticated via Clerk
    const { userId } = auth()
// If the user is not authenticated in the frontend, return a 401 Unauthorized response
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  try {
  const body = await req.json()
  const { examName, examType, examFollowup, examMaxMarks,examPassingPercentage, examDegree, examUsers, questions} = body 
  if (!examName || !examType || !examFollowup || !examPassingPercentage || !examDegree || !examUsers || !questions) {
    return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
  }
  if (typeof examMaxMarks !== 'number' ||typeof examPassingPercentage!== 'number'|| typeof examDegree !== 'string'|| !Array.isArray(examUsers) || typeof questions !== 'object') {
    return NextResponse.json({ success: false, error: "Invalid data types for examDuration or examDegree" }, { status: 400 })
  } 
  // Call the createExam function with the provided data
  await createExam(examName, examType, examFollowup, examMaxMarks, examDegree,examDegree, examUsers, questions)
    // Return a success response
  return NextResponse.json({ success: true })
} catch (error) {
  console.error("Error creating exam:", error) 
    return NextResponse.json({ success: false, error: "Failed to create exam" }, { status: 500 })
} 
}

///
/**
 * const x=await createExam(
  "AI Midterm - 2025",
  "theory",
  "Scheduled",
  100,
  40,
  "B.Tech Artificial Intelligence",
  ["664c9d1f1a4a3f1234567890", "664c9d1f1a4a3f1234567891"], // user ObjectId strings
  [
    {
      name: "Explain the concept of Artificial Intelligence with real-world examples.",
      answer: "AI refers to machines that mimic human intelligence...",
      options: [],
      type: "theory",
      bloomsTaxonomyLevel: "understand",
      marks: 10
    },
    {
      name: "What are the six levels of Bloom's Taxonomy in order?",
      answer: "Remember, Understand, Apply, Analyze, Evaluate, Create",
      options: [],
      type: "theory",
      bloomsTaxonomyLevel: "remember",
      marks: 5
    },
    {
      name: "Design a chatbot capable of handling student queries for a university portal.",
      answer: "NOT PRESENT",
      options: [],
      type: "theory",
      bloomsTaxonomyLevel: "create",
      marks: 15
    }
  ]
);

console.log(x)
 */