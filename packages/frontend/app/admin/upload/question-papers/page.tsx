"use client"
import { useRef, useState, useEffect } from "react"
import { useUser } from "@clerk/nextjs"
import { AlertCircle, RefreshCw, FileText, X, CheckCircle, XCircle, Clock, Eye, History } from "lucide-react"

type JobStatus = {
  job_id: string
  filename: string
  status: string
  s3_key?: string
  error?: string
  stages?: any
  needsSplit?: boolean
  lastChecked?: number
  uploadedToSubjects?: boolean
}

export default function Page() {
  const { user } = useUser()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState("")
  const [jobs, setJobs] = useState<JobStatus[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null)
  const [selectedJobDetails, setSelectedJobDetails] = useState<any>(null)
  const [loadingJobDetails, setLoadingJobDetails] = useState(false)
  const [questionsData, setQuestionsData] = useState<any>(null)
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all') // 'all', 'success', 'failed'
  const [extractingZip, setExtractingZip] = useState(false)
  const [uploadToSubjects, setUploadToSubjects] = useState(false)
  const [isRestoredSession, setIsRestoredSession] = useState(false)

  // Restore active session on mount
  useEffect(() => {
    const restoreSession = async () => {
      if (!user?.id) {
        setLoadingSession(false)
        return
      }

      // Don't restore if we already have jobs in progress (prevents overwriting current work)
      if (jobs.length > 0 || sessionId) {
        setLoadingSession(false)
        return
      }

      try {
        const res = await fetch('/api/upload-sessions?active=true')
        if (res.ok) {
          const data = await res.json()
          
          if (data.sessions && data.sessions.length > 0) {
            // Check if the session has any in-progress jobs worth resuming
            const latestSession = data.sessions[0]
            
            // Fetch job details for this session
            const sessionRes = await fetch(`/api/upload-sessions/${latestSession.session_id}`)
            if (sessionRes.ok) {
              const sessionData = await sessionRes.json()
              const sessionJobs = sessionData.session.jobs || []
              
              // Only restore if there are actually jobs to show
              if (sessionJobs.length === 0) {
                setLoadingSession(false)
                return
              }
              
              // Check if session has any pending jobs (not all completed/failed)
              const hasActiveJobs = sessionJobs.some((job: any) => 
                job.status === 'in_progress' || job.status === 'pending'
              )
              
              // Convert to JobStatus format
              const jobStatuses: JobStatus[] = sessionJobs.map((job: any) => ({
                job_id: job.job_id,
                filename: job.filename,
                status: job.status,
                s3_key: job.s3_pdf_key,
                error: job.error,
                stages: job.stages,
                lastChecked: Date.now()
              }))
              
              setSessionId(latestSession.session_id)
              setUploadToSubjects(latestSession.upload_to_subjects || false)
              setJobs(jobStatuses)
              setIsRestoredSession(true)
              
              if (hasActiveJobs) {
                setMessage(`✓ Resumed active session with ${jobStatuses.length} job(s)`)
              } else {
                setMessage(`📋 Loaded previous session with ${jobStatuses.length} job(s) - Click "Start New Session" to upload new files`)
              }
            }
          }
        }
      } catch (error) {
        console.error('Error restoring session:', error)
      } finally {
        setLoadingSession(false)
      }
    }

    restoreSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]) // Only run on mount when user is available

  // Poll job statuses every 5 seconds
  useEffect(() => {
    if (jobs.length === 0) return

    const interval = setInterval(async () => {
      const updatedJobs = await Promise.all(
        jobs.map(async (job) => {
          if (job.status === 'success' || job.status === 'failed') {
            return job // Don't poll completed jobs
          }

          try {
            // Use new API that queries MongoDB first
            const res = await fetch(`/api/jobs/${job.job_id}/status`)
            if (res.ok) {
              const data = await res.json()
              
              // Check if job just completed successfully and uploadToSubjects is enabled
              if (data.status === 'success' && job.status !== 'success' && uploadToSubjects && !job.uploadedToSubjects) {
                // Upload to subjects database
                console.log(`Job ${job.job_id} completed, uploading to subjects...`)
                
                // Mark as uploaded immediately to prevent race conditions
                job.uploadedToSubjects = true
                
                try {
                  const subjectRes = await fetch('/api/subjects/from-job', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      job_id: job.job_id,
                      filename: job.filename 
                    })
                  })
                  
                  if (subjectRes.ok) {
                    console.log(`Successfully uploaded ${job.filename} to subjects`)
                  } else {
                    console.error(`Failed to upload ${job.filename} to subjects`)
                    // Reset flag on failure
                    job.uploadedToSubjects = false
                  }
                } catch (error) {
                  console.error('Error uploading to subjects:', error)
                  // Reset flag on failure
                  job.uploadedToSubjects = false
                }
              }
              
              // Check if job failed due to token limit
              const needsSplit = data.error?.includes('token limit') || 
                                data.error?.includes('too large') ||
                                data.error?.includes('too big') ||
                                data.error_type === 'token_limit_exceeded'
              
              return {
                ...job,
                status: data.status,
                stages: data.stages,
                error: data.error,
                needsSplit,
                lastChecked: Date.now(),
                uploadedToSubjects: job.uploadedToSubjects // Preserve flag
              }
            }
          } catch (error) {
            console.error(`Failed to fetch status for ${job.job_id}`, error)
          }
          return job
        })
      )
      setJobs(updatedJobs)
      
      // Update session stats in MongoDB
      if (sessionId) {
        const completed = updatedJobs.filter(j => j.status === 'success').length
        const failed = updatedJobs.filter(j => j.status === 'failed').length
        const inProgress = updatedJobs.filter(j => j.status === 'in_progress').length
        
        await fetch(`/api/upload-sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            update_stats: {
              completed_jobs: completed,
              failed_jobs: failed,
              in_progress_jobs: inProgress
            }
          })
        })
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [jobs, uploadToSubjects, sessionId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const files = fileInputRef.current?.files
    
    if (!files || files.length === 0) {
      setMessage("Please select files to upload")
      return
    }

    setUploading(true)
    
    try {
      // Check if any zip files need extraction
      const zipFiles = Array.from(files).filter(f => f.name.endsWith('.zip'))
      const pdfFiles = Array.from(files).filter(f => f.name.endsWith('.pdf'))
      
      let allPdfFiles: File[] = [...pdfFiles]
      
      // Extract PDFs from zip files
      if (zipFiles.length > 0) {
        setExtractingZip(true)
        setMessage(`Extracting ${zipFiles.length} zip file(s)...`)
        
        // Dynamically import JSZip
        const JSZip = (await import('jszip')).default
        
        for (const zipFile of zipFiles) {
          try {
            const zip = new JSZip()
            const contents = await zip.loadAsync(zipFile)
            
            // Extract all PDF files from the zip
            const pdfEntries = Object.keys(contents.files).filter(name => 
              name.toLowerCase().endsWith('.pdf') && !contents.files[name].dir
            )
            
            setMessage(`Extracting ${pdfEntries.length} PDF(s) from ${zipFile.name}...`)
            
            for (const pdfPath of pdfEntries) {
              const pdfBlob = await contents.files[pdfPath].async('blob')
              const pdfFileName = pdfPath.split('/').pop() || pdfPath // Get filename without path
              const pdfFile = new File([pdfBlob], pdfFileName, { type: 'application/pdf' })
              allPdfFiles.push(pdfFile)
            }
          } catch (error: any) {
            setMessage(`✗ Failed to extract ${zipFile.name}: ${error.message}`)
            console.error('Zip extraction error:', error)
          }
        }
        
        setExtractingZip(false)
      }
      
      if (allPdfFiles.length === 0) {
        setMessage("✗ No PDF files found to upload")
        setUploading(false)
        return
      }
      
      setMessage(`Uploading ${allPdfFiles.length} PDF file(s)...`)
      
      // Clear previous session state when starting new upload
      setJobs([])
      setIsRestoredSession(false)
      
      // Upload all extracted/selected PDFs
      const formData = new FormData()
      allPdfFiles.forEach(file => {
        formData.append("files", file)
      })

      const res = await fetch("/api/upload/questionpaper/massupload", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setMessage(`✓ ${data.message}`)
        setJobs(data.jobs || [])
        
        // Create NEW upload session in MongoDB (always create fresh session for new uploads)
        const job_ids = (data.jobs || []).map((j: JobStatus) => j.job_id)
        if (job_ids.length > 0 && user?.id) {
          // Always create a new session for new uploads
          const newSessionId = crypto.randomUUID()
          
          try {
            const sessionRes = await fetch('/api/upload-sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: newSessionId,
                job_ids: job_ids,
                upload_to_subjects: uploadToSubjects
              })
            })
            
            if (sessionRes.ok) {
              setSessionId(newSessionId)
              console.log(`Session ${newSessionId} created with ${job_ids.length} jobs`)
            }
          } catch (error) {
            console.error('Failed to create session:', error)
          }
        }
        
        // Clear file input
        if (fileInputRef.current) {
          fileInputRef.current.value = ""
        }
      } else {
        setMessage(`✗ Upload failed: ${data.error || "Unknown error"}`)
      }
    } catch (error: any) {
      setMessage(`✗ Upload error: ${error.message}`)
    } finally {
      setUploading(false)
      setExtractingZip(false)
    }
  }

  const handleRetryJob = async (job: JobStatus) => {
    try {
      setMessage(`Retrying ${job.filename}...`)
      
      // Retry the job using the API - it will fetch from S3 automatically
      const res = await fetch(`/api/jobs/${job.job_id}/retry`, {
        method: "POST",
      })

      const data = await res.json()
      
      if (res.ok && data.success) {
        setMessage(`✓ ${job.filename} retry initiated successfully`)
        // Update job status to in_progress
        setJobs(jobs.map(j => 
          j.job_id === job.job_id 
            ? { 
                ...j, 
                ...data.job,
                status: data.job?.status || 'in_progress',
                error: undefined,
                lastChecked: Date.now() 
              }
            : j
        ))
      } else {
        setMessage(`✗ Retry failed for ${job.filename}: ${data.error}`)
        // Update job with the new error message from retry attempt
        setJobs(jobs.map(j => 
          j.job_id === job.job_id 
            ? { 
                ...j, 
                error: data.error,
                lastChecked: Date.now() 
              }
            : j
        ))
      }
    } catch (error: any) {
      setMessage(`✗ Retry error for ${job.filename}: ${error.message}`)
    }
  }

  const handleRemoveJob = (jobId: string) => {
    setJobs(jobs.filter(j => j.job_id !== jobId))
    setMessage(`✓ Removed job from list`)
  }

  const handleRetryAllFailed = async () => {
    const failedJobs = jobs.filter(j => j.status === 'failed' || j.status === 'partial_success')
    
    if (failedJobs.length === 0) {
      setMessage("No failed jobs to retry")
      return
    }

    setMessage(`Retrying ${failedJobs.length} failed job(s)...`)
    
    for (const job of failedJobs) {
      await handleRetryJob(job)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      case 'failed': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
      case 'partial_success': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
      case 'in_progress': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
      default: return 'bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-300'
    }
  }

  const getStageStatus = (job: JobStatus) => {
    if (!job.stages) return 'Unknown'
    
    const stages = ['ocr', 'parsing', 'enrichment', 'organization']
    const completed = stages.filter(s => job.stages[s]?.status === 'success').length
    
    return `${completed}/4 stages completed`
  }

  const viewJobDetails = async (jobId: string) => {
    setLoadingJobDetails(true)
    setQuestionsData(null)
    try {
      const res = await fetch(`http://localhost:5000/job/${jobId}/status`)
      if (res.ok) {
        const data = await res.json()
        setSelectedJobDetails(data)
        
        // If job is successful, fetch the questions
        if (data.status === 'success') {
          fetchQuestions(jobId)
        }
      } else {
        alert('Failed to load job details')
      }
    } catch (error) {
      console.error('Error loading job details:', error)
      alert('Error loading job details')
    } finally {
      setLoadingJobDetails(false)
    }
  }

  const fetchQuestions = async (jobId: string) => {
    setLoadingQuestions(true)
    try {
      const res = await fetch(`http://localhost:5000/job/${jobId}/questions`)
      if (res.ok) {
        const data = await res.json()
        setQuestionsData(data)
      } else {
        const errorText = await res.text()
        console.error('Failed to load questions:', res.status, errorText)
        
        // Fallback: check if questions are in the job status response
        if (selectedJobDetails?.questions) {
          setQuestionsData({ questions: selectedJobDetails.questions })
        } else if (selectedJobDetails?.result?.questions) {
          setQuestionsData({ questions: selectedJobDetails.result.questions })
        }
      }
    } catch (error) {
      console.error('Error loading questions:', error)
      
      // Fallback: check if questions are in the job status response
      if (selectedJobDetails?.questions) {
        setQuestionsData({ questions: selectedJobDetails.questions })
      } else if (selectedJobDetails?.result?.questions) {
        setQuestionsData({ questions: selectedJobDetails.result.questions })
      }
    } finally {
      setLoadingQuestions(false)
    }
  }

  const renderStageDetails = (stageName: string, stageData: any) => {
    if (!stageData) return null

    const getStageIcon = () => {
      if (stageData.status === 'success') return <CheckCircle className="h-5 w-5 text-green-500" />
      if (stageData.status === 'failed') return <XCircle className="h-5 w-5 text-red-500" />
      if (stageData.status === 'in_progress') return <Clock className="h-5 w-5 text-blue-500 animate-spin" />
      return <Clock className="h-5 w-5 text-gray-400" />
    }

    const getStageColor = () => {
      if (stageData.status === 'success') return 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'
      if (stageData.status === 'failed') return 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
      if (stageData.status === 'in_progress') return 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20'
      return 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'
    }

    return (
      <div className={`p-4 border rounded-lg ${getStageColor()}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {getStageIcon()}
            <h4 className="font-semibold capitalize">{stageName}</h4>
          </div>
          <span className={`px-2 py-1 text-xs rounded font-medium ${getStatusColor(stageData.status)}`}>
            {stageData.status}
          </span>
        </div>
        
        {stageData.error && (
          <div className="mb-3 p-2 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded text-sm">
            <p className="font-medium text-red-800 dark:text-red-200">Error:</p>
            <p className="text-red-700 dark:text-red-300">{stageData.error}</p>
          </div>
        )}

        <div className="space-y-2 text-sm">
          {stageData.start_time && (
            <p className="text-gray-600 dark:text-gray-400">
              <span className="font-medium">Started:</span> {new Date(stageData.start_time).toLocaleString()}
            </p>
          )}
          {stageData.end_time && (
            <p className="text-gray-600 dark:text-gray-400">
              <span className="font-medium">Completed:</span> {new Date(stageData.end_time).toLocaleString()}
            </p>
          )}
          {stageData.duration && (
            <p className="text-gray-600 dark:text-gray-400">
              <span className="font-medium">Duration:</span> {stageData.duration}
            </p>
          )}

          {/* OCR specific details */}
          {stageName === 'ocr' && stageData.result && (
            <div className="mt-3 p-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
              <p className="font-medium mb-2">OCR Results:</p>
              {stageData.result.pages_processed && (
                <p className="text-gray-600 dark:text-gray-400">Pages Processed: {stageData.result.pages_processed}</p>
              )}
              {stageData.result.text_blocks && (
                <p className="text-gray-600 dark:text-gray-400">Text Blocks: {stageData.result.text_blocks}</p>
              )}
              {stageData.result.confidence && (
                <p className="text-gray-600 dark:text-gray-400">Average Confidence: {(stageData.result.confidence * 100).toFixed(1)}%</p>
              )}
            </div>
          )}

          {/* Parsing specific details */}
          {stageName === 'parsing' && stageData.result && (
            <div className="mt-3 p-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
              <p className="font-medium mb-2">Parsing Results:</p>
              {stageData.result.questions_found !== undefined && (
                <p className="text-gray-600 dark:text-gray-400">Questions Found: {stageData.result.questions_found}</p>
              )}
              {stageData.result.sections !== undefined && (
                <p className="text-gray-600 dark:text-gray-400">Sections: {stageData.result.sections}</p>
              )}
            </div>
          )}

          {/* Enrichment specific details */}
          {stageName === 'enrichment' && stageData.result && (
            <div className="mt-3 p-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
              <p className="font-medium mb-2">Enrichment Results:</p>
              {stageData.result.questions_enriched !== undefined && (
                <p className="text-gray-600 dark:text-gray-400">Questions Enriched: {stageData.result.questions_enriched}</p>
              )}
              {stageData.result.topics_identified !== undefined && (
                <p className="text-gray-600 dark:text-gray-400">Topics Identified: {stageData.result.topics_identified}</p>
              )}
            </div>
          )}

          {/* Organization specific details */}
          {stageName === 'organization' && stageData.result && (
            <div className="mt-3 p-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
              <p className="font-medium mb-2">Organization Results:</p>
              {stageData.result.subjects_identified !== undefined && (
                <p className="text-gray-600 dark:text-gray-400">Subjects Identified: {stageData.result.subjects_identified}</p>
              )}
              {stageData.result.questions_organized !== undefined && (
                <p className="text-gray-600 dark:text-gray-400">Questions Organized: {stageData.result.questions_organized}</p>
              )}
              {stageData.result.subjects && Array.isArray(stageData.result.subjects) && (
                <div className="mt-2">
                  <p className="text-gray-600 dark:text-gray-400 mb-1">Subjects:</p>
                  <div className="flex flex-wrap gap-1">
                    {stageData.result.subjects.map((subject: string, idx: number) => (
                      <span key={idx} className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs">
                        {subject}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="bg-white dark:bg-gray-900 p-8 rounded shadow-md w-full max-w-4xl">
        <h2 className="text-2xl font-bold mb-6">Upload Question Papers</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Select PDF files or ZIP archives (.pdf, .zip format)
            </label>
            <input
              type="file"
              multiple
              ref={fileInputRef}
              className="w-full p-2 border rounded dark:bg-gray-800 dark:border-gray-700"
              accept=".pdf,.zip"
              disabled={uploading || extractingZip}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Upload multiple PDFs or a ZIP file containing PDFs. Large PDFs are automatically chunked.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="uploadToSubjects"
              checked={uploadToSubjects}
              onChange={(e) => setUploadToSubjects(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              disabled={uploading || extractingZip}
            />
            <label htmlFor="uploadToSubjects" className="text-sm font-medium">
              Also upload to Subjects Database
              <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                (Creates past papers and adds questions to subject repository)
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={uploading || extractingZip}
            className="w-full bg-blue-600 text-white px-4 py-3 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
          >
            {extractingZip ? "Extracting ZIP..." : uploading ? "Uploading..." : "Upload & Process"}
          </button>
        </form>

        {/* Loading Session Indicator */}
        {loadingSession && (
          <div className="mt-4 p-4 rounded bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Checking for active sessions...
          </div>
        )}

        {/* Status Message */}
        {message && !loadingSession && (
          <div className={`mt-4 p-4 rounded ${
            message.startsWith("✓") 
              ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
              : message.startsWith("✗")
              ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
              : message.startsWith("📋")
              ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
              : "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
          }`}>
            {message}
          </div>
        )}

        {/* Job Status */}
        {jobs.length > 0 && (
          <div className="mt-6">
            {/* Restored Session Banner */}
            {isRestoredSession && (
              <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                  <History className="h-4 w-4" />
                  <span className="text-sm font-medium">Viewing restored session</span>
                </div>
                <button
                  onClick={() => {
                    setJobs([])
                    setSessionId(null)
                    setIsRestoredSession(false)
                    setMessage('')
                  }}
                  className="text-sm bg-amber-600 text-white px-3 py-1 rounded hover:bg-amber-700 flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  Start New Session
                </button>
              </div>
            )}
            
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold">Processing Jobs ({jobs.filter(j => 
                statusFilter === 'all' || 
                (statusFilter === 'success' && j.status === 'success') ||
                (statusFilter === 'failed' && (j.status === 'failed' || j.status === 'partial_success'))
              ).length})</h3>
              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="text-sm border rounded px-3 py-1.5 dark:bg-gray-800 dark:border-gray-700"
                >
                  <option value="all">All Jobs</option>
                  <option value="success">Success Only</option>
                  <option value="failed">Failed Only</option>
                </select>
                {jobs.some(j => j.status === 'failed' || j.status === 'partial_success') && (
                  <button
                    onClick={handleRetryAllFailed}
                    className="flex items-center gap-2 text-sm bg-yellow-600 text-white px-3 py-1.5 rounded hover:bg-yellow-700"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retry All Failed
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {jobs.filter(j => 
                statusFilter === 'all' || 
                (statusFilter === 'success' && j.status === 'success') ||
                (statusFilter === 'failed' && (j.status === 'failed' || j.status === 'partial_success'))
              ).map((job) => (
                <div 
                  key={job.job_id} 
                  className="p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        <p className="font-medium">{job.filename}</p>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Job ID: {job.job_id}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {getStageStatus(job)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 text-xs rounded font-medium ${getStatusColor(job.status)}`}>
                        {job.status}
                      </span>
                      <button
                        onClick={() => handleRemoveJob(job.job_id)}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
                        title="Remove job from list"
                      >
                        <X className="h-4 w-4 text-gray-500 hover:text-red-600" />
                      </button>
                    </div>
                  </div>

                  {job.error && (
                    <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-300">
                      <AlertCircle className="h-4 w-4 inline mr-1" />
                      {job.error}
                    </div>
                  )}

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => viewJobDetails(job.job_id)}
                      className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      View Details
                    </button>
                    {(job.status === 'failed' || job.status === 'partial_success') && (
                      <button
                        onClick={() => handleRetryJob(job)}
                        className="text-sm text-orange-600 dark:text-orange-400 hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retry
                      </button>
                    )}
                  </div>

                  {job.lastChecked && (
                    <p className="text-xs text-gray-500 mt-2">
                      Last updated: {new Date(job.lastChecked).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded text-sm">
          <p className="font-semibold mb-2">How it works:</p>
          <ol className="list-decimal list-inside space-y-1 text-gray-600 dark:text-gray-400">
            <li>Select one or more PDF question papers (any size)</li>
            <li>Files are uploaded to S3 storage</li>
            <li>AWS Textract extracts text (OCR)</li>
            <li>Large PDFs are automatically split into manageable chunks</li>
            <li>AI parses questions from extracted text</li>
            <li>Questions are enriched with metadata (Bloom's Taxonomy, difficulty, etc.)</li>
            <li>Organized by subject automatically and merged seamlessly</li>
          </ol>
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <p className="font-semibold mb-1 text-green-700 dark:text-green-300">✨ Smart Processing:</p>
            <p className="text-gray-600 dark:text-gray-400">
              The system intelligently handles PDFs of any size by automatically splitting and merging them in the background.
              You'll see a single job with all questions combined, regardless of the original size!
            </p>
          </div>
        </div>
      </div>

      {/* Job Details Modal */}
      {selectedJobDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-xl font-bold">Job Details</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {selectedJobDetails.filename}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  Job ID: {selectedJobDetails.job_id}
                </p>
              </div>
              <button
                onClick={() => setSelectedJobDetails(null)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Overall Status */}
              <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold mb-1">Overall Status</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {selectedJobDetails.created_at && (
                        <span>Started: {new Date(selectedJobDetails.created_at).toLocaleString()}</span>
                      )}
                    </p>
                  </div>
                  <span className={`px-3 py-1.5 text-sm rounded font-medium ${getStatusColor(selectedJobDetails.status)}`}>
                    {selectedJobDetails.status}
                  </span>
                </div>

                {selectedJobDetails.error && (
                  <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                    <p className="text-sm text-red-700 dark:text-red-300">
                      <AlertCircle className="h-4 w-4 inline mr-1" />
                      {selectedJobDetails.error}
                    </p>
                  </div>
                )}

                {selectedJobDetails.s3_key && (
                  <div className="mt-3">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      <span className="font-medium">S3 Location:</span> {selectedJobDetails.s3_key}
                    </p>
                  </div>
                )}
              </div>

              {/* Pipeline Stages */}
              {selectedJobDetails.stages && (
                <div>
                  <h4 className="font-semibold mb-4 text-lg">Pipeline Stages</h4>
                  <div className="space-y-4">
                    {renderStageDetails('ocr', selectedJobDetails.stages.ocr)}
                    {renderStageDetails('parsing', selectedJobDetails.stages.parsing)}
                    {renderStageDetails('enrichment', selectedJobDetails.stages.enrichment)}
                    {renderStageDetails('organization', selectedJobDetails.stages.organization)}
                  </div>
                </div>
              )}

              {/* Questions Results */}
              {selectedJobDetails.status === 'success' && (
                <div className="mt-6">
                  <h4 className="font-semibold mb-4 text-lg">Processed Questions</h4>
                  
                  {loadingQuestions ? (
                    <div className="flex items-center justify-center p-8">
                      <RefreshCw className="h-6 w-6 animate-spin text-blue-500 mr-2" />
                      <span>Loading questions...</span>
                    </div>
                  ) : questionsData ? (
                    <div className="space-y-4">
                      {questionsData.questions && questionsData.questions.length > 0 ? (
                        questionsData.questions.map((q: any, idx: number) => (
                          <div key={idx} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-start gap-2 flex-1">
                                <span className="text-sm font-bold text-blue-600 dark:text-blue-400 mt-1">Q{idx + 1}</span>
                                <p className="text-gray-800 dark:text-gray-200 leading-relaxed">{q.questionText || q.question_text || q.text || 'No question text'}</p>
                              </div>
                            </div>
                            
                            {/* Metadata Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                              {q.bloomsTaxonomy && (
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">Bloom's Taxonomy</span>
                                  <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-sm font-medium w-fit">
                                    {q.bloomsTaxonomy}
                                  </span>
                                </div>
                              )}
                              
                              {q.difficulty && (
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">Difficulty</span>
                                  <span className={`px-2 py-1 rounded text-sm font-medium w-fit ${
                                    q.difficulty.toLowerCase() === 'easy' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
                                    q.difficulty.toLowerCase() === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' :
                                    'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                  }`}>
                                    {q.difficulty}
                                  </span>
                                </div>
                              )}
                              
                              {q.marks && (
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">Marks</span>
                                  <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-sm font-medium w-fit">
                                    {q.marks}
                                  </span>
                                </div>
                              )}
                              
                              {q.subject && (
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">Subject</span>
                                  <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded text-sm font-medium w-fit">
                                    {q.subject}
                                  </span>
                                </div>
                              )}
                              
                              {q.topic && (
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">Topic</span>
                                  <span className="px-2 py-1 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded text-sm font-medium w-fit">
                                    {q.topic}
                                  </span>
                                </div>
                              )}
                              
                              {q.questionType && (
                                <div className="flex flex-col">
                                  <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">Type</span>
                                  <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm font-medium w-fit">
                                    {q.questionType}
                                  </span>
                                </div>
                              )}
                            </div>
                            
                            {/* Additional metadata */}
                            {(q.learningOutcome || q.keywords || q.tags) && (
                              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                {q.learningOutcome && (
                                  <div className="mb-2">
                                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Learning Outcome: </span>
                                    <span className="text-sm text-gray-700 dark:text-gray-300">{q.learningOutcome}</span>
                                  </div>
                                )}
                                {q.keywords && Array.isArray(q.keywords) && q.keywords.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mr-1">Keywords:</span>
                                    {q.keywords.map((keyword: string, kidx: number) => (
                                      <span key={kidx} className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs">
                                        {keyword}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {q.tags && Array.isArray(q.tags) && q.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mr-1">Tags:</span>
                                    {q.tags.map((tag: string, tidx: number) => (
                                      <span key={tidx} className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                          No questions found in the results
                        </div>
                      )}
                      
                      {questionsData.summary && (
                        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                          <h5 className="font-semibold mb-2 text-blue-900 dark:text-blue-100">Summary</h5>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            {questionsData.summary.totalQuestions !== undefined && (
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Total Questions:</span>
                                <span className="ml-2 font-semibold text-blue-700 dark:text-blue-300">{questionsData.summary.totalQuestions}</span>
                              </div>
                            )}
                            {questionsData.summary.subjects !== undefined && (
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Subjects:</span>
                                <span className="ml-2 font-semibold text-blue-700 dark:text-blue-300">{questionsData.summary.subjects}</span>
                              </div>
                            )}
                            {questionsData.summary.avgDifficulty && (
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Avg Difficulty:</span>
                                <span className="ml-2 font-semibold text-blue-700 dark:text-blue-300">{questionsData.summary.avgDifficulty}</span>
                              </div>
                            )}
                            {questionsData.summary.totalMarks !== undefined && (
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Total Marks:</span>
                                <span className="ml-2 font-semibold text-blue-700 dark:text-blue-300">{questionsData.summary.totalMarks}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 text-center text-gray-600 dark:text-gray-400">
                      <button
                        onClick={() => fetchQuestions(selectedJobDetails.job_id)}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        Click to load questions
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Additional Info */}
              {selectedJobDetails.metadata && (
                <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <h4 className="font-semibold mb-2">Additional Information</h4>
                  <pre className="text-xs text-gray-600 dark:text-gray-400 overflow-x-auto">
                    {JSON.stringify(selectedJobDetails.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <a
                href={`http://localhost:5000/job/${selectedJobDetails.job_id}/status`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View Raw JSON →
              </a>
              <button
                onClick={() => setSelectedJobDetails(null)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}