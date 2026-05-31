"use client"

import type React from "react"
import { use, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Loader2, CheckCircle2, XCircle, AlertCircle, Split, FileText, ArrowLeft, RefreshCw } from "lucide-react"
import { Badge } from "@/frontend/components/ui/badge"
import { Progress } from "@/frontend/components/ui/progress"

interface UploadStatus {
  fileName: string
  status: "pending" | "uploading" | "processing" | "success" | "error"
  analysisId?: string
  error?: string
  progress?: number
  extractedMetadata?: {
    subjectName?: string
    year?: string
    semester?: string
  }
}

interface UploadSession {
  sessionId: string
  statuses: UploadStatus[]
  createdAt: number
  uploadMode: "multiple" | "zip"
  totalFiles: number
}

export default function UploadStatusPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const resolvedParams = use(params)
  const sessionId = resolvedParams.sessionId
  const router = useRouter()
  
  const [uploadSession, setUploadSession] = useState<UploadSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<{ success: boolean; message: string } | null>(null)

  // Load session from localStorage
  useEffect(() => {
    loadSession()
    
    // Auto-refresh every 2 seconds if there are pending/processing uploads
    const interval = setInterval(() => {
      if (autoRefresh) {
        loadSession()
      }
    }, 2000)
    
    return () => clearInterval(interval)
  }, [sessionId, autoRefresh])

  const loadSession = () => {
    try {
      const storedSession = localStorage.getItem(`upload-session-${sessionId}`)
      if (storedSession) {
        const session: UploadSession = JSON.parse(storedSession)
        setUploadSession(session)
        
        // Stop auto-refresh if all uploads are complete
        const hasActiveUploads = session.statuses.some(
          s => s.status === "uploading" || s.status === "processing" || s.status === "pending"
        )
        if (!hasActiveUploads) {
          setAutoRefresh(false)
        }
      } else {
        // Session not found
        setUploadSession(null)
      }
    } catch (error) {
      console.error("Error loading session:", error)
      setUploadSession(null)
    } finally {
      setIsLoading(false)
    }
  }

  const clearSession = () => {
    if (confirm("Are you sure you want to clear this upload session? This cannot be undone.")) {
      localStorage.removeItem(`upload-session-${sessionId}`)
      router.push("/ai-analyze-bulk")
    }
  }

  const handlePublishAll = async () => {
    if (!uploadSession) return

    const successfulAnalyses = uploadSession.statuses
      .filter(s => s.status === "success" && s.analysisId)
      .map(s => s.analysisId!)

    if (successfulAnalyses.length === 0) {
      alert("No successful analyses to publish")
      return
    }

    if (!confirm(`Publish ${successfulAnalyses.length} analyses to the question bank? They will be visible in the /subjects page.`)) {
      return
    }

    setIsPublishing(true)
    setPublishResult(null)

    try {
      const response = await fetch("/api/exam-analysis/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisIds: successfulAnalyses,
          publishedBy: "system", // TODO: Replace with actual user ID from auth
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setPublishResult({
          success: true,
          message: data.message || "Successfully published all analyses",
        })
        // Refresh to show publish status
        setTimeout(() => {
          setPublishResult(null)
          router.push("/subjects")
        }, 2000)
      } else {
        setPublishResult({
          success: false,
          message: data.error || "Failed to publish analyses",
        })
      }
    } catch (error) {
      console.error("Error publishing:", error)
      setPublishResult({
        success: false,
        message: "Network error: Failed to publish analyses",
      })
    } finally {
      setIsPublishing(false)
    }
  }

  const getStatusIcon = (status: UploadStatus["status"]) => {
    switch (status) {
      case "pending":
        return <FileText className="h-5 w-5 text-muted-foreground" />
      case "uploading":
      case "processing":
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case "error":
        return <XCircle className="h-5 w-5 text-red-500" />
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!uploadSession) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle>Upload Session Not Found</CardTitle>
            <CardDescription>
              The upload session with ID "{sessionId}" could not be found or has expired.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push("/ai-analyze-bulk")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Upload
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const successCount = uploadSession.statuses.filter((s) => s.status === "success").length
  const errorCount = uploadSession.statuses.filter((s) => s.status === "error").length
  const processingCount = uploadSession.statuses.filter(
    (s) => s.status === "uploading" || s.status === "processing" || s.status === "pending"
  ).length

  const isComplete = processingCount === 0

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-6 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Upload Status</h1>
            <p className="text-sm text-muted-foreground">
              Session ID: {sessionId}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/ai-analyze-bulk")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Upload
            </Button>
            {isComplete && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearSession}
              >
                Clear Session
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {isComplete ? "Upload Complete" : "Uploading & Processing"}
              </CardTitle>
              <CardDescription>
                {successCount} succeeded, {errorCount} failed, {processingCount} in progress, {uploadSession.totalFiles} total
              </CardDescription>
            </div>
            {!isComplete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={loadSession}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {uploadSession.statuses.map((status, idx) => {
              const isSplitFile = status.fileName.includes(" - ") && 
                                 idx > 0 && 
                                 uploadSession.statuses[idx-1]?.fileName.split(" - ")[0] === status.fileName.split(" - ")[0]
              
              return (
                <div 
                  key={idx} 
                  className={`flex flex-col gap-2 rounded-lg border p-3 ${isSplitFile ? 'ml-6 border-l-4 border-l-blue-500/50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      {isSplitFile && <Split className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />}
                      {getStatusIcon(status.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{status.fileName}</p>
                        {isSplitFile && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Split className="h-3 w-3" />
                            Auto-detected from multi-subject PDF
                          </p>
                        )}
                        {status.extractedMetadata && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {status.extractedMetadata.subjectName && (
                              <Badge variant="secondary" className="text-xs">
                                {status.extractedMetadata.subjectName}
                              </Badge>
                            )}
                            {status.extractedMetadata.year && (
                              <Badge variant="outline" className="text-xs">
                                {status.extractedMetadata.year}
                              </Badge>
                            )}
                            {status.extractedMetadata.semester && (
                              <Badge variant="outline" className="text-xs">
                                {status.extractedMetadata.semester}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {status.status === "success" && status.analysisId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/analysis-report/${status.analysisId}`)}
                      >
                        View
                      </Button>
                    )}
                  </div>
                  {status.status === "uploading" && status.progress !== undefined && (
                    <Progress value={status.progress} className="h-1" />
                  )}
                  {status.error && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {status.error}
                    </p>
                  )}
                </div>
              )
            })}
          </div>

          {isComplete && successCount > 0 && (
            <div className="mt-4 pt-4 border-t space-y-3">
              {publishResult && (
                <div className={`p-3 rounded-lg ${publishResult.success ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                  <p className="text-sm font-medium">{publishResult.message}</p>
                </div>
              )}
              
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  variant="default"
                  onClick={handlePublishAll}
                  disabled={isPublishing}
                >
                  {isPublishing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Publish All to Question Bank
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/ai-analyze")}
                >
                  View All
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
