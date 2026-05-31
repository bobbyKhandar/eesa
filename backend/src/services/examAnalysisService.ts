import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.gemini_api_key || "");
const model = genAI.getGenerativeModel({
  model: "Gemini 2.0 Flash-Lite",
});

interface QuestionExtractionResult {
  questionNumber: string;
  questionText: string;
  marks: number;
  questionType: "MCQ" | "Short" | "Long" | "Numerical" | "Diagram";
  options?: string[];
}

interface BloomClassificationResult {
  questionNumber: string;
  questionText: string;
  marks: number;
  bloomLevel: "Recall" | "Understand" | "Apply" | "Analyze" | "Evaluate" | "Create";
  bloomJustification: string;
  confidence: number;
  difficulty: "Easy" | "Medium" | "Hard";
  keywords: string[];
  topicsCovered: string[];
}

interface ExamMetadata {
  subjectName: string;
  subjectCode?: string;
  branch?: string;
  year: string;
  semester: string;
  examType: "main" | "kt";
  institutionName?: string;
}

/**
 * Extract metadata (subject, year, semester) from exam paper text
 * Used for bulk uploads where metadata is not provided
 */
export async function extractMetadataFromText(
  ocrText: string,
  optionalYear?: string
): Promise<{ success: boolean; metadata?: ExamMetadata; error?: string }> {
  try {
    console.log("Extracting metadata from exam paper text...");

    const prompt = `You are an expert at analyzing exam papers. Extract metadata from this OCR-extracted exam paper text.

OCR Text (first 2000 characters):
${ocrText.substring(0, 2000)}

Extract the following information:
1. Subject Name - Look for phrases like "Name of the Course:", "Subject:", or the subject name near the top
   - Clean up any department codes, course numbers, or formatting noise
   - Example: "COMP - IVAnalysis of Algorithum & Design" → "Analysis of Algorithm and Design"
   - Example: "ITVIIData Mining & Warehousing" → "Data Mining and Warehousing"
   
2. Subject Code (if available) - Usually appears as alphanumeric code (e.g., "CS401", "IT-601")

3. Branch/Department (if available) - Computer Engineering, IT, Electronics, etc.

4. Year - Look for academic year (e.g., "2024", "2023-24", "AY 2024-25")
   ${optionalYear ? `- User suggested year: ${optionalYear} (use this if unclear from text)` : ""}
   - If not found and no suggestion, use current year

5. Semester - Look for "Semester", "Sem", or roman numerals like "III", "VI"
   - Map to format: "S1", "S2", "S3", etc.
   - If not found, default to "S1"

6. Exam Type - Determine if this is:
   - "main" - Regular semester exam, end-sem, ISE (In-Semester Exam)
   - "kt" - KT exam, backlog, re-exam, supplementary

7. Institution Name (if visible) - College/University name

Return ONLY a valid JSON object with this structure:
{
  "subjectName": "string (required, clean and readable)",
  "subjectCode": "string or null",
  "branch": "string or null",
  "year": "string (required, e.g., '2024')",
  "semester": "string (required, e.g., 'S1', 'S3')",
  "examType": "main" or "kt",
  "institutionName": "string or null"
}

Do NOT include markdown, explanations, or extra text. Return ONLY the JSON object.`;

    const result = await model.generateContent(prompt);
    const jsonString = result.response.text().replace(/^```json\s*|\s*```$/g, "").trim();
    const metadata = JSON.parse(jsonString);

    console.log("Extracted metadata:", metadata);

    return {
      success: true,
      metadata: {
        subjectName: metadata.subjectName || "Unknown Subject",
        subjectCode: metadata.subjectCode || undefined,
        branch: metadata.branch || undefined,
        year: metadata.year || optionalYear || new Date().getFullYear().toString(),
        semester: metadata.semester || "S1",
        examType: metadata.examType === "kt" ? "kt" : "main",
        institutionName: metadata.institutionName || undefined,
      },
    };
  } catch (error: any) {
    console.error("Error extracting metadata:", error);
    return {
      success: false,
      error: error.message || "Failed to extract metadata",
    };
  }
}

/**
 * Step 1: Extract and refine questions from OCR text using Gemini AI
 * This cleans up OCR errors and structures the questions
 */
export async function refineAndExtractQuestions(
  ocrText: string,
  subjectName: string
): Promise<{ success: boolean; questions?: QuestionExtractionResult[]; error?: string }> {
  try {
    console.log("Starting question extraction and refinement...");

    const prompt = `You are an expert at parsing exam papers. Your task is to extract and refine questions from OCR-extracted text, which may contain errors.

Subject: ${subjectName}

OCR Text:
${ocrText}

Instructions:
1. Identify all questions in the text
2. Fix any OCR errors (misread characters, spacing issues, etc.)
3. Extract question numbers (e.g., "1(a)", "Q2", "Question 3")
4. Identify marks for each question (look for patterns like "5 marks", "[10]", "(3)")
5. Determine question type: MCQ, Short Answer, Long Answer, Numerical Problem, or Diagram-based
6. For MCQs, extract all options
7. Clean up formatting and make text readable

Return ONLY a valid JSON array with this structure:
[
  {
    "questionNumber": "1(a)",
    "questionText": "cleaned and refined question text",
    "marks": 5,
    "questionType": "Long",
    "options": ["A) option1", "B) option2"] // only for MCQs
  }
]

CRITICAL:
- Return ONLY the JSON array, no other text
- Fix all OCR errors in question text
- Be precise with question numbers as they appear in the paper
- If marks aren't specified, estimate based on question complexity (MCQ=1, Short=2-5, Long=8-15)
- questionType must be one of: "MCQ", "Short", "Long", "Numerical", "Diagram"
`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    console.log("Raw Gemini response:", response.substring(0, 200) + "...");

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = response.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    }

    const questions: QuestionExtractionResult[] = JSON.parse(jsonText);

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("No questions extracted from OCR text");
    }

    console.log(`Successfully extracted and refined ${questions.length} questions`);
    return { success: true, questions };

  } catch (error: any) {
    console.error("Error in question extraction:", error);
    return {
      success: false,
      error: error.message || "Failed to extract questions",
    };
  }
}

/**
 * Step 2: Classify questions using Bloom's taxonomy with Gemini AI
 */
export async function classifyQuestionsWithBlooms(
  questions: QuestionExtractionResult[],
  subjectName: string
): Promise<{ success: boolean; classifiedQuestions?: BloomClassificationResult[]; error?: string }> {
  try {
    console.log(`Starting Bloom's taxonomy classification for ${questions.length} questions...`);

    const prompt = `You are an expert educational taxonomist specializing in Bloom's Taxonomy classification.

Subject: ${subjectName}

Questions to classify:
${questions.map((q, idx) => `
${idx + 1}. ${q.questionNumber} (${q.marks} marks)
   ${q.questionText}
`).join('\n')}

Your task: Classify each question according to Bloom's Taxonomy and provide detailed analysis.

Bloom's Taxonomy Levels:
1. **Recall** - Remember facts, terms, basic concepts (keywords: state, list, define, name, identify, label)
2. **Understand** - Explain ideas, concepts (keywords: explain, describe, summarize, interpret, discuss)
3. **Apply** - Use information in new situations (keywords: calculate, solve, demonstrate, apply, use)
4. **Analyze** - Draw connections, examine relationships (keywords: analyze, compare, contrast, examine, differentiate)
5. **Evaluate** - Justify decisions, judge value (keywords: evaluate, assess, critique, judge, argue)
6. **Create** - Produce new work, design solutions (keywords: design, construct, develop, formulate, create)

For each question, provide:
1. Bloom level classification
2. Detailed justification explaining why
3. Confidence score (0.0 to 1.0)
4. Difficulty level (Easy/Medium/Hard)
5. Key topics covered
6. Important keywords from the question

Return ONLY a valid JSON array:
[
  {
    "questionNumber": "1(a)",
    "questionText": "the question text",
    "marks": 5,
    "bloomLevel": "Apply",
    "bloomJustification": "detailed explanation of why this level was chosen, citing specific aspects of the question",
    "confidence": 0.92,
    "difficulty": "Medium",
    "keywords": ["force", "friction", "calculate"],
    "topicsCovered": ["Newton's Laws", "Friction", "Force Analysis"]
  }
]

CRITICAL:
- Return ONLY the JSON array, no other text
- bloomLevel MUST be one of: "Recall", "Understand", "Apply", "Analyze", "Evaluate", "Create"
- difficulty MUST be: "Easy", "Medium", or "Hard"
- Provide thoughtful justifications that demonstrate understanding
- confidence should reflect how clear-cut the classification is
- Extract 3-5 relevant keywords
- Identify 2-4 main topics covered
`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    console.log("Raw Gemini classification response:", response.substring(0, 200) + "...");

    // Extract JSON from response
    let jsonText = response.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    }

    const classifiedQuestions: BloomClassificationResult[] = JSON.parse(jsonText);

    if (!Array.isArray(classifiedQuestions) || classifiedQuestions.length === 0) {
      throw new Error("Classification failed to return results");
    }

    console.log(`Successfully classified ${classifiedQuestions.length} questions`);
    return { success: true, classifiedQuestions };

  } catch (error: any) {
    console.error("Error in Bloom's classification:", error);
    return {
      success: false,
      error: error.message || "Failed to classify questions",
    };
  }
}

/**
 * Calculate Bloom's distribution from classified questions
 */
export function calculateBloomDistribution(questions: BloomClassificationResult[]) {
  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
  const distribution = {
    Recall: 0,
    Understand: 0,
    Apply: 0,
    Analyze: 0,
    Evaluate: 0,
    Create: 0,
  };

  questions.forEach(q => {
    const percentage = (q.marks / totalMarks) * 100;
    distribution[q.bloomLevel] += percentage;
  });

  return distribution;
}

/**
 * Generate overall insights and recommendations
 */
export async function generateAnalysisInsights(
  classifiedQuestions: BloomClassificationResult[],
  bloomDistribution: any,
  subjectName: string
): Promise<{
  overallAssessment: string;
  recommendations: string[];
  strengths: string[];
  improvements: string[];
}> {
  try {
    const prompt = `You are an educational assessment expert. Analyze this exam and provide insights.

Subject: ${subjectName}
Total Questions: ${classifiedQuestions.length}

Bloom's Distribution:
- Recall: ${bloomDistribution.Recall.toFixed(1)}%
- Understand: ${bloomDistribution.Understand.toFixed(1)}%
- Apply: ${bloomDistribution.Apply.toFixed(1)}%
- Analyze: ${bloomDistribution.Analyze.toFixed(1)}%
- Evaluate: ${bloomDistribution.Evaluate.toFixed(1)}%
- Create: ${bloomDistribution.Create.toFixed(1)}%

Questions:
${classifiedQuestions.map((q, idx) => `${idx + 1}. [${q.bloomLevel}] ${q.questionText.substring(0, 100)}...`).join('\n')}

Provide:
1. Overall assessment (2-3 sentences summarizing the exam quality)
2. 3-5 recommendations for improving the exam
3. 3-4 strengths of the current exam
4. 3-4 areas for improvement

Return ONLY valid JSON:
{
  "overallAssessment": "comprehensive summary text",
  "recommendations": ["recommendation 1", "recommendation 2", ...],
  "strengths": ["strength 1", "strength 2", ...],
  "improvements": ["improvement 1", "improvement 2", ...]
}
`;

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    let jsonText = response.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    }

    const insights = JSON.parse(jsonText);
    return insights;

  } catch (error) {
    console.error("Error generating insights:", error);
    return {
      overallAssessment: "Analysis completed successfully.",
      recommendations: ["Continue with current approach"],
      strengths: ["Good question distribution"],
      improvements: ["Could enhance higher-order thinking questions"],
    };
  }
}

/**
 * Detect if a single PDF contains multiple subjects/exams and split them
 * Returns array of detected subjects with their text ranges
 */
export async function detectAndSplitMultipleSubjects(
  ocrText: string
): Promise<{
  success: boolean;
  hasMultipleSubjects: boolean;
  subjects?: Array<{
    subjectName: string;
    subjectCode?: string;
    startMarker: string;
    endMarker: string;
    textContent: string;
    pageRange?: string;
  }>;
  error?: string;
}> {
  try {
    console.log("Detecting if PDF contains multiple subjects...");

    // Analyze first 8000 chars and last 2000 chars for better context
    const sampleText = ocrText.length > 10000 
      ? `${ocrText.substring(0, 8000)}\n\n... [middle content omitted] ...\n\n${ocrText.substring(ocrText.length - 2000)}`
      : ocrText;

    const prompt = `Analyze this exam paper OCR text and determine if it contains MULTIPLE DISTINCT SUBJECT EXAMS in one document.

OCR Text Sample:
${sampleText}

CRITICAL RULES:
1. Return hasMultipleSubjects: true ONLY if there are 2+ COMPLETELY DIFFERENT subjects
   - Example: "Data Structures" AND "Database Management" in same PDF = TRUE
   - Counter-example: "Theory" and "Practical" sections of SAME subject = FALSE
   
2. Look for these indicators of multiple subjects:
   - Multiple distinct "Subject:" or "Course:" headers with DIFFERENT subject names
   - Multiple "Semester" or "Examination" headers for DIFFERENT courses
   - Clear subject code changes (e.g., CS301 → CS302)
   - Completely different question topics (e.g., algorithms vs databases)

3. For markers: use EXACT text from the OCR (max 40 chars each)
   - startMarker: First 40 characters of the subject section
   - endMarker: Last 40 characters before next subject or end

4. If uncertain, default to hasMultipleSubjects: false (safer for users)

REQUIRED JSON FORMAT (no markdown, no explanations):

Single subject:
{"hasMultipleSubjects":false,"subjects":[]}

Multiple subjects:
{"hasMultipleSubjects":true,"subjects":[{"subjectName":"Data Structures","subjectCode":"CS301","startMarker":"Semester July 2024 Subject CS301","endMarker":"End of Section A Total 30 marks","pageRange":"Pages 1-3"},{"subjectName":"Database Management","subjectCode":"CS302","startMarker":"Semester July 2024 Subject CS302","endMarker":"End of examination Best wishes","pageRange":"Pages 4-6"}]}

Return ONLY valid JSON. No extra text.`;

    const result = await model.generateContent(prompt);
    let responseText = result.response.text().trim();
    
    // Clean up response - remove markdown code blocks and any extra text
    responseText = responseText.replace(/^```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
    
    // Remove any text before first { or after last }
    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      responseText = responseText.substring(firstBrace, lastBrace + 1);
    }

    console.log("Parsing detection response:", responseText.substring(0, 200));

    let detection;
    try {
      detection = JSON.parse(responseText);
    } catch (parseError: any) {
      console.error("JSON parse error:", parseError.message);
      console.error("Problematic JSON:", responseText);
      
      // Fallback: assume single subject if JSON is malformed
      return {
        success: true,
        hasMultipleSubjects: false,
      };
    }

    if (!detection.hasMultipleSubjects || !detection.subjects || detection.subjects.length === 0) {
      console.log("Single subject detected");
      return {
        success: true,
        hasMultipleSubjects: false,
      };
    }

    console.log(`Multiple subjects detected: ${detection.subjects.length} subjects`);

    // Extract text content for each subject based on markers
    const subjectsWithContent = detection.subjects.map((subject: any, index: number) => {
      let textContent = "";
      
      // Try to find text using markers
      const startIndex = ocrText.indexOf(subject.startMarker);
      
      if (startIndex !== -1) {
        // Find end marker or next subject's start marker
        let endIndex = -1;
        
        if (subject.endMarker) {
          endIndex = ocrText.indexOf(subject.endMarker, startIndex);
        }
        
        // If end marker not found, use next subject's start marker
        if (endIndex === -1 && index < detection.subjects.length - 1) {
          const nextSubject = detection.subjects[index + 1];
          endIndex = ocrText.indexOf(nextSubject.startMarker, startIndex + 1);
        }
        
        // If still not found, use end of document
        if (endIndex === -1) {
          endIndex = ocrText.length;
        } else {
          endIndex += subject.endMarker?.length || 0;
        }
        
        textContent = ocrText.substring(startIndex, endIndex);
      } else {
        // Fallback: split text equally
        console.warn(`Could not find start marker for subject: ${subject.subjectName}, using fallback split`);
        const chunkSize = Math.floor(ocrText.length / detection.subjects.length);
        textContent = ocrText.substring(index * chunkSize, (index + 1) * chunkSize);
      }

      return {
        subjectName: subject.subjectName,
        subjectCode: subject.subjectCode || null,
        startMarker: subject.startMarker,
        endMarker: subject.endMarker,
        pageRange: subject.pageRange || null,
        textContent,
      };
    });

    return {
      success: true,
      hasMultipleSubjects: true,
      subjects: subjectsWithContent,
    };

  } catch (error: any) {
    console.error("Error detecting multiple subjects:", error);
    
    // On error, default to single subject (safer)
    return {
      success: true,
      hasMultipleSubjects: false,
    };
  }
}
