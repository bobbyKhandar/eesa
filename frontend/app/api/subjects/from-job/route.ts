import { NextRequest, NextResponse } from "next/server";
import { ExamAnalysisRepository } from "@/backend/dist/database/repositories/ExamAnalysisRepository";
import { PromptRepository } from "@/backend/dist/database/repositories/PromptRepository";
import { SubjectRepository } from "@/backend/dist/database/repositories/SubjectRepository";
import { AnalysisReportRepository } from "@/backend/dist/database/repositories/AnalysisReportRepository";
import { UniqueQuestionRepository } from "@/backend/src/database/repositories/UniqueQuestionRepository";
import { JobMetadataRepository } from "@/backend/src/database/repositories/JobMetadataRepository";
import { connect } from "@/backend/dist/database/connect";
import { 
  updateSimilarityRelationships,
  findAndLinkSimilarQuestions 
} from "@/backend/src/services/questionSimilarityService";

// Import types directly from source since backend has compile errors
type BloomLevel = "Recall" | "Understand" | "Apply" | "Analyze" | "Evaluate" | "Create";
type Difficulty = "Easy" | "Medium" | "Hard";

interface AnalyzedQuestion {
  questionNumber: string;
  questionText: string;
  marks: number;
  bloomLevel: BloomLevel;
  bloomJustification?: string;
  confidence?: number;
  syllabusTopics?: string[];
  moduleNumber?: number;
  isSyllabusAligned?: boolean;
  similarQuestionIds?: string[];
  appearanceFrequency?: {
    count: number;
    years: number[];
  };
  difficulty?: Difficulty;
  keywords?: string[];
}

interface ExamAnalysis {
  subjectCode: string;
  subjectName: string;
  branch?: string;
  year: string;
  semester: string;
  examType: "main" | "kt";
  originalFile?: {
    fileName: string;
    fileUrl?: string;
    fileType?: string;
    fileSize?: number;
  };
  status?: string;
  analyzedBy?: string;
  analyzedAt?: Date;
  questions: AnalyzedQuestion[];
  totalQuestions?: number;
  totalMarks?: number;
  bloomDistribution?: {
    Recall: number;
    Understand: number;
    Apply: number;
    Analyze: number;
    Evaluate: number;
    Create: number;
  };
  overallAssessment?: string;
  recommendations?: string[];
  strengths?: string[];
  improvements?: string[];
  userNotes?: string;
  isPublished?: boolean;
  isPublic?: boolean;
  metadata?: any;
}

const AI_PIPELINE_URL = process.env.AI_PIPELINE_URL || "http://192.168.1.105:5000";

/**
 * Calculate similarity between two strings (0-1, where 1 is identical)
 * Uses normalized Levenshtein distance
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1.0;
  
  // Check if one is contained in the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;
  
  // Levenshtein distance
  const matrix: number[][] = [];
  
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  const maxLength = Math.max(s1.length, s2.length);
  const distance = matrix[s2.length][s1.length];
  
  return 1 - (distance / maxLength);
}

/**
 * Find similar existing subject by name
 * Returns the most similar subject if similarity > threshold
 */
async function findSimilarSubject(
  subjectName: string,
  subjectRepo: SubjectRepository,
  threshold: number = 0.85
): Promise<any | null> {
  try {
    // Get all subjects
    const allSubjects = await subjectRepo.getAll();
    
    let bestMatch: any = null;
    let bestSimilarity = 0;
    
    for (const subject of allSubjects) {
      const similarity = calculateStringSimilarity(subjectName, subject.name);
      
      if (similarity > bestSimilarity && similarity >= threshold) {
        bestSimilarity = similarity;
        bestMatch = subject;
      }
    }
    
    if (bestMatch) {
      console.log(`[Subject Matching] Found similar subject: "${bestMatch.name}" (${(bestSimilarity * 100).toFixed(1)}% match to "${subjectName}")`);
    }
    
    return bestMatch;
  } catch (error) {
    console.error('[Subject Matching] Error finding similar subject:', error);
    return null;
  }
}

/**
 * POST /api/subjects/from-job
 * Create exam analysis from a completed AI pipeline job and save to MAIN database
 * 
 * Request body: { job_id: string, filename: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { job_id, filename } = await request.json();

    if (!job_id || !filename) {
      return NextResponse.json(
        { error: "job_id and filename are required" },
        { status: 400 }
      );
    }

    // Connect to MAIN database
    await connect();
    
    // Check if this job has already been imported (idempotency check)
    const jobMetadataRepo = new JobMetadataRepository();
    const existingJob = await jobMetadataRepo.findById(job_id);
    
    if (existingJob) {
      console.log(`[Subjects Upload] Job ${job_id} already imported, skipping duplicate import`);
      return NextResponse.json({
        success: true,
        job_id,
        filename,
        message: "Job already imported (duplicate request prevented)",
        alreadyImported: true,
      });
    }

    // Fetch enriched data from AI pipeline
    console.log(`[Subjects Upload] Fetching enriched data for job ${job_id}...`);
    
    // Fetch from questions endpoint (returns flat list)
    const questionsRes = await fetch(`${AI_PIPELINE_URL}/job/${job_id}/questions`);
    
    if (!questionsRes.ok) {
      const errorText = await questionsRes.text();
      console.error(`[Subjects Upload] Failed to fetch data: ${questionsRes.statusText} - ${errorText}`);
      return NextResponse.json(
        { error: "Failed to fetch data from pipeline" },
        { status: questionsRes.status }
      );
    }

    const questionsData = await questionsRes.json();
    
    // Now the endpoint returns {exams: [...]} directly, no need to convert
    let enrichedData = questionsData;
    
    // Verify we have exams
    if (!enrichedData.exams || !Array.isArray(enrichedData.exams)) {
      console.error(`[Subjects Upload] Invalid response format - expected {exams: [...]}`, enrichedData);
      return NextResponse.json(
        { error: "Invalid response format from pipeline" },
        { status: 500 }
      );
    }
    
    console.log(`[Subjects Upload] Received ${enrichedData.exams.length} exam(s) with complete enrichment data`);
    
    if (!enrichedData || !enrichedData.exams || enrichedData.exams.length === 0) {
      console.warn(`[Subjects Upload] No exam data found for job ${job_id}`);
      return NextResponse.json(
        { error: "No exam data found in enriched output" },
        { status: 404 }
      );
    }

    const examAnalysisRepo = new ExamAnalysisRepository();
    const promptRepo = new PromptRepository();
    const subjectRepo = new SubjectRepository();
    const analysisReportRepo = new AnalysisReportRepository();
    const uniqueQuestionRepo = new UniqueQuestionRepository();
    
    const results = [];

    // Process each exam
    for (const exam of enrichedData.exams) {
      try {
        const {
          subject,
          subjectCode,
          year,
          semester,
          branch,
          examType,
          questions,
        } = exam;

        // Auto-create subject if it doesn't exist
        if (subjectCode) {
          try {
            // First, try to find by exact code
            let existingSubject = await subjectRepo.getByCode(subjectCode);
            
            // If no exact match by code, try to find similar subject by name
            if (!existingSubject) {
              existingSubject = await findSimilarSubject(subject, subjectRepo, 0.85);
              
              if (existingSubject) {
                console.log(`[Subjects Upload] Using existing similar subject: ${existingSubject.name} (${existingSubject.code}) for "${subject}" (${subjectCode})`);
                // Update the subject name and code for consistency
                subject = existingSubject.name;
                subjectCode = existingSubject.code;
              }
            }
            
            if (!existingSubject) {
              console.log(`[Subjects Upload] Creating new subject: ${subject} (${subjectCode})`);
              
              // Map year/semester to expected format
              const yearMap: Record<string, "FY" | "SY" | "TY" | "LY"> = {
                "2021": "FY", "2022": "SY", "2023": "TY", "2024": "LY",
                "2025": "FY", "2026": "SY", "2027": "TY", "2028": "LY"
              };
              
              const subjectData = {
                name: subject,
                code: subjectCode,
                branch: branch || "CSE",
                year: yearMap[year] || "SY",
                semester: `Semester ${semester || "1"}`,
                credits: 4,
                type: "Core" as const,
                description: `Auto-generated from OCR pipeline - ${subject}`,
                duration: "16 weeks",
                isActive: true,
                topics: [],
                learningOutcomes: [],
                assessmentStructure: [],
                textbooks: [],
                references: [],
                metadata: {
                  autoCreated: true,
                  source: "ai-pipeline-ocr",
                  createdFrom: job_id,
                  createdAt: new Date().toISOString()
                }
              };
              
              await subjectRepo.create(subjectData as any);
              console.log(`[Subjects Upload] ✓ Subject created: ${subjectCode}`);
            } else {
              console.log(`[Subjects Upload] ✓ Using existing subject: ${existingSubject.code}`);
            }
          } catch (subjectError) {
            console.error(`[Subjects Upload] Failed to create subject ${subjectCode}:`, subjectError);
            // Continue even if subject creation fails
          }
        }

        // Convert questions to AnalyzedQuestion format
        const analyzedQuestions: AnalyzedQuestion[] = [];
        const promptIds: string[] = [];

        for (const q of questions) {
          // Create prompt for each question with all available fields
          const promptData: any = {
            questionText: q.questionText,
            subject: subject,
            subjectCode: subjectCode || undefined,
            branch: branch || undefined,
            topic: q.syllabusTopics?.join(", ") || q.topicsCovered?.join(", ") || undefined,
            generateVia: "ocr" as const,
            source: filename,
            ocrConfidence: q.confidence || 0.9,
            createdBy: "ai-pipeline",
            bloomsLevel: mapBloomLevel(q.bloomLevel),
            // Include all enrichment fields
            bloomLevel: q.bloomLevel || undefined,
            bloomJustification: q.bloomJustification || undefined,
            confidence: q.confidence || undefined,
            difficulty: q.difficulty || undefined,
            keywords: q.keywords || [],
            topicsCovered: q.topicsCovered || [],
            marks: q.marks?.toString() || undefined,
            // Similarity and clustering fields
            clusterId: q.clusterId || undefined,
            hasSimilarQuestions: q.similarQuestionIds && q.similarQuestionIds.length > 0,
          };
          
          // Add appearanceFrequency if complete
          if (q.appearanceFrequency && 
              typeof q.appearanceFrequency.count === 'number' && 
              Array.isArray(q.appearanceFrequency.years) &&
              q.appearanceFrequency.years.length > 0) {
            promptData.appearanceFrequency = {
              count: q.appearanceFrequency.count,
              years: q.appearanceFrequency.years
            };
          }

          const promptResult = await promptRepo.create(promptData);
          
          if (promptResult.success && promptResult.promptId) {
            promptIds.push(promptResult.promptId);
            
            // Find and link similar questions using text-based similarity
            // This runs for EVERY prompt to find similar questions in the database
            try {
              const similarityResult = await findAndLinkSimilarQuestions(
                promptResult.promptId,
                q.questionText,
                subject,
                promptIds // Exclude prompts we just created in this batch
              );
              
              if (similarityResult.linkedCount > 0) {
                console.log(`[Similarity] Linked question with ${similarityResult.linkedCount} similar questions`);
              }
            } catch (error) {
              console.error(`Failed to find similar questions for ${q.questionNumber}:`, error);
              // Continue even if similarity update fails
            }
          }

          // Build analyzed question with all enrichment fields
          const analyzedQuestion: any = {
            questionNumber: q.questionNumber || `Q${analyzedQuestions.length + 1}`,
            questionText: q.questionText,
            marks: q.marks || 0,
            // Bloom's taxonomy
            bloomLevel: q.bloomLevel || "Understand",
            bloomJustification: q.bloomJustification || "",
            confidence: q.confidence,
            // Syllabus alignment
            syllabusTopics: q.syllabusTopics || [],
            isSyllabusAligned: q.isSyllabusAligned !== undefined ? q.isSyllabusAligned : true,
            // Past paper comparison - only include if complete
            similarQuestionIds: q.similarQuestionIds || [],
            // Additional metadata
            difficulty: q.difficulty || "Medium",
            keywords: q.keywords || [],
          };
          
          // Only add optional fields if they have complete data
          if (q.moduleNumber !== undefined && q.moduleNumber !== null) {
            analyzedQuestion.moduleNumber = q.moduleNumber;
          }
          
          if (q.appearanceFrequency && 
              typeof q.appearanceFrequency.count === 'number' && 
              Array.isArray(q.appearanceFrequency.years)) {
            analyzedQuestion.appearanceFrequency = {
              count: q.appearanceFrequency.count,
              years: q.appearanceFrequency.years
            };
          }
          
          analyzedQuestions.push(analyzedQuestion);
        }

        // Calculate Bloom's distribution
        const bloomDistribution = {
          Recall: analyzedQuestions.filter(q => q.bloomLevel === "Recall").length,
          Understand: analyzedQuestions.filter(q => q.bloomLevel === "Understand").length,
          Apply: analyzedQuestions.filter(q => q.bloomLevel === "Apply").length,
          Analyze: analyzedQuestions.filter(q => q.bloomLevel === "Analyze").length,
          Evaluate: analyzedQuestions.filter(q => q.bloomLevel === "Evaluate").length,
          Create: analyzedQuestions.filter(q => q.bloomLevel === "Create").length,
        };

        // Create exam analysis
        const examAnalysisData: Partial<ExamAnalysis> = {
          subjectCode: subjectCode || "UNKNOWN",
          subjectName: subject,
          branch: branch || "CSE",
          year: year || new Date().getFullYear().toString(),
          semester: semester || "1",
          examType: (examType?.toLowerCase() as "main" | "kt") || "main",
          questions: analyzedQuestions,
          totalQuestions: analyzedQuestions.length,
          totalMarks: analyzedQuestions.reduce((sum, q) => sum + q.marks, 0),
          bloomDistribution,
          overallAssessment: `Analyzed ${analyzedQuestions.length} questions from ${subject}`,
          originalFile: {
            fileName: filename,
            fileUrl: `s3://eesa-pipeline-storage/jobs/${job_id}/original/${filename}`,
            fileType: filename.split('.').pop()?.toLowerCase() || 'pdf',
            fileSize: 0,
          },
          status: "completed",
          analyzedBy: "ai-pipeline", // Required field - system user ID
          analyzedAt: new Date(),
          isPublished: false,
          metadata: {
            aiProcessed: true,
            jobId: job_id,
            processingDate: new Date().toISOString(),
            source: "ai-pipeline-textract",
          },
        };

        const result = await examAnalysisRepo.create(examAnalysisData as ExamAnalysis);

        if (result.success) {
          // Auto-create AnalysisReport to make it visible on subjects page
          let reportId = null;
          try {
            console.log(`[Subjects Upload] Creating analysis report for ${subject}...`);
            
            // Create the analysis report with the prompts we already created
            const reportData: any = {
              examAnalysisId: result.analysisId,
              subjectCode: subjectCode || "UNKNOWN",
              subjectName: subject,
              branch: branch || "CSE",
              year: year || new Date().getFullYear().toString(),
              semester: semester || "1",
              examType: (examType?.toLowerCase() as "main" | "kt") || "main",
              questionIds: promptIds, // Use the prompts we already created
              totalQuestions: analyzedQuestions.length,
              totalMarks: analyzedQuestions.reduce((sum, q) => sum + q.marks, 0),
              bloomDistribution,
              overallAssessment: `Analyzed ${analyzedQuestions.length} questions from ${subject}`,
              originalFileName: filename,
              originalFileUrl: `s3://eesa-pipeline-storage/jobs/${job_id}/original/${filename}`,
              publishedBy: "ai-pipeline",
              publishedAt: new Date(),
              tags: [],
              viewCount: 0,
              isPublic: true, // Make it public so it shows up on subjects page
            };
            
            const report = await analysisReportRepo.create(reportData);
            reportId = report._id;
            
            console.log(`[Subjects Upload] ✓ Created analysis report ${reportId}`);
            
            // Add questions to UniqueQuestions collection for deduplication
            console.log(`[Subjects Upload] Adding ${analyzedQuestions.length} questions to UniqueQuestions...`);
            let uniqueCount = 0;
            let duplicateCount = 0;
            
            for (let i = 0; i < analyzedQuestions.length; i++) {
              const q = analyzedQuestions[i];
              const promptId = promptIds[i];
              
              if (!promptId) continue;
              
              try {
                // Normalize question text for deduplication
                const normalizedText = q.questionText
                  .toLowerCase()
                  .replace(/[^\w\s]/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                
                const uniqueQuestionData = {
                  questionText: q.questionText,
                  normalizedText,
                  subject: subject,
                  subjectCode: subjectCode || undefined,
                  topics: q.keywords || [],
                  bloomsLevel: mapBloomLevel(q.bloomLevel),
                  bloomLevel: q.bloomLevel,
                  promptIds: [promptId],
                  tags: [],
                  isVerified: false,
                  isActive: true,
                  sourceReports: [],
                  occurrenceCount: 1,
                  firstSeenAt: new Date(),
                  lastSeenAt: new Date(),
                  appearances: [],
                  analysisReportId: reportId!,
                  year: year || new Date().getFullYear().toString(),
                  semester: semester || "1",
                  examType: (examType?.toLowerCase() as "main" | "kt") || "main",
                  estimatedMarks: q.marks,
                };
                
                const uniqueResult = await uniqueQuestionRepo.findOrCreate(uniqueQuestionData);
                
                if (uniqueResult.isNew) {
                  uniqueCount++;
                } else {
                  duplicateCount++;
                }
              } catch (uniqueError) {
                console.error(`[Subjects Upload] Error adding question to UniqueQuestions:`, uniqueError);
                // Continue even if one question fails
              }
            }
            
            console.log(`[Subjects Upload] ✓ Added to UniqueQuestions: ${uniqueCount} new, ${duplicateCount} duplicates`);
            
            // Update exam analysis to mark as published
            await examAnalysisRepo.update(result.analysisId!, {
              status: "published",
              isPublished: true,
              publishedAt: new Date(),
            });
            
          } catch (reportError) {
            console.error(`[Subjects Upload] Error creating analysis report:`, reportError);
            // Continue even if report creation fails - at least the exam analysis is saved
          }
          
          results.push({
            success: true,
            subject: subject,
            examAnalysisId: result.analysisId,
            reportId: reportId,
            questionsAdded: promptIds.length,
            totalQuestions: analyzedQuestions.length,
          });

          console.log(`[Subjects Upload] Created exam analysis for ${subject}: ${result.analysisId}`);
        } else {
          results.push({
            success: false,
            subject: subject,
            error: result.error,
          });
        }
      } catch (examError: any) {
        console.error(`[Subjects Upload] Error processing exam:`, examError);
        results.push({
          success: false,
          subject: exam.subject,
          error: examError.message,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    
    // Save job metadata to MongoDB for session persistence
    try {
      console.log(`[Subjects Upload] Fetching job metadata for ${job_id}...`);
      const metadataRes = await fetch(`${AI_PIPELINE_URL}/job/${job_id}/status`);
      
      if (metadataRes.ok) {
        const jobMetadata = await metadataRes.json();
        const jobMetadataRepo = new JobMetadataRepository();
        
        // Extract subjects from results
        const subjects = results
          .filter(r => r.success && r.subject)
          .map(r => r.subject as string);
        
        // Calculate total questions from results
        const totalQuestions = results.reduce((sum, r) => sum + (r.totalQuestions || 0), 0);
        
        await jobMetadataRepo.create({
          job_id: job_id,
          filename: filename,
          status: jobMetadata.status || 'success',
          s3_pdf_key: jobMetadata.s3_pdf_key,
          s3_metadata_key: `jobs/${job_id}/metadata.json`,
          s3_master_index_key: jobMetadata.stages?.organization?.master_index_s3_key,
          started_at: jobMetadata.started_at ? new Date(jobMetadata.started_at) : new Date(),
          completed_at: jobMetadata.completed_at ? new Date(jobMetadata.completed_at) : new Date(),
          error: jobMetadata.error,
          error_type: jobMetadata.error_type,
          failed_stage: jobMetadata.failed_stage,
          stages: jobMetadata.stages,
          total_questions: totalQuestions,
          subjects: subjects,
          s3_expired: false,
          retention_days: 90
        });
        
        console.log(`[Subjects Upload] Job metadata saved to MongoDB for ${job_id}`);
      } else {
        console.warn(`[Subjects Upload] Could not fetch job metadata: ${metadataRes.statusText}`);
      }
    } catch (metadataError) {
      console.error(`[Subjects Upload] Error saving job metadata:`, metadataError);
      // Don't fail the request if metadata saving fails
    }
    
    return NextResponse.json({
      success: successCount > 0,
      job_id,
      filename,
      results,
      message: `Successfully saved ${successCount}/${results.length} exam(s) to MAIN database`,
    });

  } catch (error: any) {
    console.error("[Subjects Upload] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process upload" },
      { status: 500 }
    );
  }
}

/**
 * Map Bloom's level from pipeline format to database format
 */
function mapBloomLevel(bloomLevel: string): "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create" {
  const mapping: Record<string, "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create"> = {
    "Recall": "remember",
    "Remember": "remember",
    "Understand": "understand",
    "Apply": "apply",
    "Analyze": "analyze",
    "Analyse": "analyze",
    "Evaluate": "evaluate",
    "Create": "create",
  };

  return mapping[bloomLevel] || "understand";
}
