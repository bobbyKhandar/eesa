import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import {connectToDb,createExam} from "@/backend/database/db.js"


export async function POST(req: Request) {

// Ensure the request is authenticated via Clerk
    const { userId } = auth()
// If the user is not authenticated in the frontend, return a 401 Unauthorized response
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  try {
  const body = await req.json()
  const { examName, examType, examFollowup, examDuration, examDegree, examUsers, questions } = body 
  if (!examName || !examType || !examFollowup || !examDuration || !examDegree || !examUsers || !questions) {
    return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 })
  }
  if (typeof examDuration !== 'number' || typeof examDegree !== 'string'|| !Array.isArray(examUsers) || typeof questions !== 'object') {
    return NextResponse.json({ success: false, error: "Invalid data types for examDuration or examDegree" }, { status: 400 })
  } 
  connectToDb()
  // Call the createExam function with the provided data
  await createExam(examName, examType, examFollowup, examDuration, examDegree, examUsers, questions)
    // Return a success response
  return NextResponse.json({ success: true })
} catch (error) {
  console.error("Error creating exam:", error) 
    return NextResponse.json({ success: false, error: "Failed to create exam" }, { status: 500 })

} 
}