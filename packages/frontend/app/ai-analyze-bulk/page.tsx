"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
import { Checkbox } from "@/frontend/components/ui/checkbox"
import { Upload, FileArchive, FileText, Loader2 } from "lucide-react"

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

export default function BulkUploadPage() {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [uploadMode, setUploadMode] = useState<"multiple" | "zip">("multiple")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [optionalYear, setOptionalYear] = useState("")
  const [notes, setNotes] = useState("")
  const [autoExtractMetadata, setAutoExtractMetadata] = useState(true)

  function handleMultipleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter(
        (file) => file.type === "application/pdf" || 
                 file.name.endsWith(".pdf")
      )
      setFiles(selectedFiles)
    }
  }

  function handleZipFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      setZipFile(e.target.files[0])
    }
  }

  // Generate unique session ID
  function generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  // Save session to localStorage
  function saveSession(session: UploadSession) {
    localStorage.setItem(`upload-session-${session.sessionId}`, JSON.stringify(session))
  }

  // Update session in localStorage
  function updateSession(sessionId: string, statuses: UploadStatus[]) {
    const storedSession = localStorage.getItem(`upload-session-${sessionId}`)
    if (storedSession) {
      const session: UploadSession = JSON.parse(storedSession)
      session.statuses = statuses
      localStorage.setItem(`upload-session-${sessionId}`, JSON.stringify(session))
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (uploadMode === "multiple" && files.length === 0) {
      alert("Please select at least one PDF file.")
      return
    }

    if (uploadMode === "zip" && !zipFile) {
      alert("Please select a ZIP file.")
      return
    }

    setIsSubmitting(true)

    // Create session
    const sessionId = generateSessionId()
    const initialStatuses: UploadStatus[] = uploadMode === "multiple" 
      ? files.map(file => ({ fileName: file.name, status: "pending" as const }))
      : [{ fileName: zipFile!.name, status: "pending" as const }]
    
    const session: UploadSession = {
      sessionId,
      statuses: initialStatuses,
      createdAt: Date.now(),
      uploadMode,
      totalFiles: uploadMode === "multiple" ? files.length : 1,
    }
    
    saveSession(session)

    // Redirect to status page
    router.push(`/upload-status/${sessionId}`)

    // Start upload process in background
    try {
      if (uploadMode === "multiple") {
        // Upload files one by one
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          
          // Update status to uploading
          session.statuses[i].status = "uploading"
          session.statuses[i].progress = 0
          updateSession(sessionId, session.statuses)

          try {
            const formData = new FormData()
            formData.append("file", file)
            formData.append("autoExtractMetadata", String(autoExtractMetadata))
            formData.append("optionalYear", optionalYear)
            formData.append("userNotes", notes)

            const response = await fetch("/api/exam-analysis/upload-bulk", {
              method: "POST",
              body: formData,
            })

            const data = await response.json()

            if (!data.success) {
              throw new Error(data.error || "Upload failed")
            }

            // Check if multiple subjects were detected
            if (data.multipleSubjects && data.analyses) {
              // Multiple analyses created from one PDF
              console.log(`PDF split into ${data.count} subjects`)
              
              // Update status for all split subjects
              const newStatuses: UploadStatus[] = []
              
              for (let j = 0; j < session.statuses.length; j++) {
                if (j < i) {
                  // Keep previous files as-is
                  newStatuses.push(session.statuses[j])
                } else if (j === i) {
                  // Replace current file with split subjects
                  for (const analysis of data.analyses) {
                    newStatuses.push({
                      fileName: `${file.name} - ${analysis.subjectName}`,
                      status: "success",
                      analysisId: analysis.analysisId,
                      progress: 100,
                      extractedMetadata: {
                        subjectName: analysis.extractedMetadata.subjectName,
                        year: analysis.extractedMetadata.year,
                        semester: analysis.extractedMetadata.semester,
                      },
                    })
                  }
                } else {
                  // Keep remaining files
                  newStatuses.push(session.statuses[j])
                }
              }
              
              session.statuses = newStatuses
              session.totalFiles = newStatuses.length
              updateSession(sessionId, session.statuses)
            } else {
              // Single subject - update normally
              session.statuses[i] = {
                ...session.statuses[i],
                status: "success",
                analysisId: data.analysisId,
                progress: 100,
                extractedMetadata: data.extractedMetadata,
              }
              updateSession(sessionId, session.statuses)
            }
          } catch (error: any) {
            // Update status to error
            session.statuses[i] = {
              ...session.statuses[i],
              status: "error",
              error: error.message || "Upload failed",
            }
            updateSession(sessionId, session.statuses)
          }
        }
      } else {
        // Handle ZIP upload
        session.statuses[0].status = "uploading"
        updateSession(sessionId, session.statuses)
        
        const formData = new FormData()
        formData.append("zipFile", zipFile!)
        formData.append("autoExtractMetadata", String(autoExtractMetadata))
        formData.append("optionalYear", optionalYear)
        formData.append("userNotes", notes)

        const response = await fetch("/api/exam-analysis/upload-bulk-zip", {
          method: "POST",
          body: formData,
        })

        const data = await response.json()

        if (!data.success) {
          throw new Error(data.error || "ZIP upload failed")
        }

        // Set upload statuses from response
        session.statuses = data.results || []
        session.totalFiles = session.statuses.length
        updateSession(sessionId, session.statuses)
      }
    } catch (error: any) {
      console.error("Error uploading files:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Bulk Upload & Analyze</h1>
        <p className="text-sm text-muted-foreground">
          Upload multiple exam papers at once. AI will automatically extract subject names, years, and semesters from
          each paper.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload Files</CardTitle>
          <CardDescription>Select multiple PDFs or upload a ZIP file containing exam papers.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-6">
              {/* Upload Mode Selection */}
              <div className="space-y-3">
                <Label>Upload Mode</Label>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setUploadMode("multiple")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                      uploadMode === "multiple"
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-muted-foreground/50"
                    }`}
                  >
                    <FileText className="h-5 w-5" />
                    <span className="font-medium">Multiple PDFs</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode("zip")}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                      uploadMode === "zip"
                        ? "border-primary bg-primary/5"
                        : "border-muted hover:border-muted-foreground/50"
                    }`}
                  >
                    <FileArchive className="h-5 w-5" />
                    <span className="font-medium">ZIP Archive</span>
                  </button>
                </div>
              </div>

              {/* File Input */}
              {uploadMode === "multiple" ? (
                <div className="space-y-2">
                  <Label htmlFor="files">Select PDF Files</Label>
                  <Input
                    id="files"
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    onChange={handleMultipleFilesChange}
                    disabled={isSubmitting}
                  />
                  {files.length > 0 && (
                    <p className="text-xs text-muted-foreground">{files.length} file(s) selected</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="zipFile">Select ZIP File</Label>
                  <Input
                    id="zipFile"
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    onChange={handleZipFileChange}
                    disabled={isSubmitting}
                  />
                  {zipFile && <p className="text-xs text-muted-foreground">{zipFile.name}</p>}
                </div>
              )}

              {/* Auto Extract Metadata */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="autoExtract"
                  checked={autoExtractMetadata}
                  onCheckedChange={(checked) => setAutoExtractMetadata(checked === true)}
                  disabled={isSubmitting}
                />
                <Label htmlFor="autoExtract" className="text-sm font-normal">
                  Auto-extract subject, year, and semester from exam papers using AI
                </Label>
              </div>

              {/* Optional Year */}
              <div className="space-y-2">
                <Label htmlFor="optionalYear">
                  Optional: Specify Year <span className="text-muted-foreground">(leave blank for auto-detect)</span>
                </Label>
                <Input
                  id="optionalYear"
                  type="text"
                  placeholder="e.g., 2024, 2025"
                  value={optionalYear}
                  onChange={(e) => setOptionalYear(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any additional notes about these exam papers..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isSubmitting}
                  rows={3}
                />
              </div>

              {/* Submit Button */}
              <Button type="submit" className="w-full" disabled={isSubmitting || (uploadMode === "multiple" && files.length === 0) || (uploadMode === "zip" && !zipFile)}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload & Analyze
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
  )
}
