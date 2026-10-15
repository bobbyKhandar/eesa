"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
import { ArrowLeft } from "lucide-react"
import { ExamTypeSelector, SyllabusTypeSelector, SubjectSelector, QuestionEditor, StudentAssigneeSelector } from "@/frontend/components/features/exams"
import type { Question } from "@/frontend/components/features/exams"
import { authoringKind, createQuestionDraft, examUsersForCreation, findExamDetailsFieldErrors, findExamSettingsFieldErrors, findInvalidQuestion, findMissingStudentAssignees, mergeQuestionUpdate, nextQuestionId, toCreateExamQuestions } from "@/frontend/lib/examCreation"

export default function CreateExamPage() {
  const [examType, setExamType] = useState<"personal" | "teacher" | null>(null)
  const [syllabusType, setSyllabusType] = useState<string | null>(null)
  const [selectedBranch, setSelectedBranch] = useState("")
  const [selectedSemester, setSelectedSemester] = useState("")
  const [selectedSubject, setSelectedSubject] = useState("")
  const [questions, setQuestions] = useState<Question[]>([createQuestionDraft("theory", 1)])

  const addQuestion = (type: string) => {
    const kind = authoringKind(type)
    if (!kind) return
    setQuestions([...questions, createQuestionDraft(kind, nextQuestionId(questions))])
  }
  const [examTitle,setExamTitle]=useState<string>("")
  const [examDescription,setExamDescription]=useState<string>("")
  const [examDuration,setExamDuration]=useState<number>(60)
  const [passingPercentage,setPassingPercentage]=useState<number>(35)
  const [examDegree,setExamDegree]=useState<string>("")
  const [subject,setSubject]=useState<string>("")
  const [instructions,setInstructions]=useState<string>("")
  const [negativeMarking,setNegativeMarking]=useState<boolean>(false)
  const [negativeMarkingPercentage,setNegativeMarkingPercentage]=useState<number>(25)
  const [deadline,setDeadline]=useState<string>("")
  const [selectedStudentIds,setSelectedStudentIds]=useState<string[]>([])
  const [processingRequest,setProcessingRequest]=useState<boolean>(false)
  const [error,setError]=useState<string>("")
  const [success,setSuccess]=useState<string>("")
  const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({})

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const removeQuestion = (id: number) => {
    setQuestions(questions.filter((q) => q.id !== id))
  }

  const updateQuestion = (id: number, data: Partial<Question>) => {
    setQuestions(questions.map((q) => (q.id === id ? mergeQuestionUpdate(q, data) : q)))
  }

  interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
  examId?: string;
}

async function uploadExamSet(): Promise<ApiResponse> {
  try {
    // Trimmed required-field checks so whitespace-only values cannot submit.
    const detailErrors = findExamDetailsFieldErrors({ examTitle, examDescription, subject, examDegree })
    const settingsErrors = findExamSettingsFieldErrors({
      passingPercentage,
      duration: examDuration,
      negativeMarking,
      negativeMarkingPercentage,
    })
    const nextFieldErrors: Record<string, string> = { ...detailErrors, ...settingsErrors }
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors)
      const firstError =
        nextFieldErrors.examTitle ??
        nextFieldErrors.examDescription ??
        nextFieldErrors.subject ??
        nextFieldErrors.examDegree ??
        nextFieldErrors.passingPercentage ??
        nextFieldErrors.duration ??
        nextFieldErrors.negativeMarkingPercentage ??
        "Please fix the highlighted fields"
      setError(firstError)
      return { success: false, error: firstError }
    }
    setFieldErrors({})

    if (questions.length === 0) {
      setError("Please add at least one question")
      return { success: false, error: "No questions added" }
    }

    const questionError = findInvalidQuestion(questions)
    if (questionError) {
      setError(questionError)
      return { success: false, error: questionError }
    }

    const assigneeError = findMissingStudentAssignees(examType, selectedStudentIds)
    if (assigneeError) {
      setError(assigneeError)
      return { success: false, error: assigneeError }
    }

    setProcessingRequest(true)
    setError("")
    setSuccess("")

    // Calculate total marks
    const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0)

    const payload = {
      examTitle,
      examDescription,
      subject,
      examDegree,
      examType: examType || "assignment",
      passingPercentage,
      duration: examDuration,
      scheduledAt: deadline ? new Date(deadline).toISOString() : undefined,
      instructions,
      negativeMarking,
      negativeMarkingPercentage: negativeMarking ? negativeMarkingPercentage : undefined,
      examMaxMarks: totalMarks,
      examUsers: examUsersForCreation(examType, selectedStudentIds),
      questions: toCreateExamQuestions(questions)
    }

    const response = await fetch(`/api/exams/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok || !data.success) {
      setError(data.error || "Failed to create exam")
      return { success: false, error: data.error }
    }

    setSuccess("Exam created successfully!")
    return { success: true, message: data.message, examId: data.examId }

  } catch (err: any) {
    console.error("Error creating exam:", err)
    setError(err.message || "Network error occurred")
    return { success: false, error: err.message }
  } finally {
    setProcessingRequest(false)
  }
}

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const response = await uploadExamSet()
    if (response.success) {
      setTimeout(() => {
        window.location.href = '/dashboard/exams'
      }, 2000)
    }
  }
  // Step 1: Select exam type (Personal Use or Teacher Assignment)
  if (!examType) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/exams">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">Create New Exam</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Select Exam Type</CardTitle>
            <p className="text-sm text-gray-500 dark:text-gray-400">Choose how you want to use this exam</p>
          </CardHeader>
          <CardContent>
            <ExamTypeSelector onSelect={(t) => setExamType(t)} />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Step 2: Select syllabus type (Pre-uploaded or Personal)
  if (!syllabusType) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => setExamType(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold">Create New Exam</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Select Syllabus Type</CardTitle>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {examType === "personal"
                ? "Choose which syllabus to use for your personal exam"
                : "Choose which syllabus to use for your student assignment"}
            </p>
          </CardHeader>
          <CardContent>
            <SyllabusTypeSelector
              examType={examType}
              onSelect={(t) => setSyllabusType(t)}
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  // Step 3: If pre-uploaded syllabus, select branch, semester, and subject
  if (syllabusType === "pre-uploaded" && (!selectedBranch || !selectedSemester || !selectedSubject)) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={() => setSyllabusType(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold">Select Subject</h1>
        </div>
        <SubjectSelector
          branch={selectedBranch}
          semester={selectedSemester}
          subject={selectedSubject}
          onBranchChange={setSelectedBranch}
          onSemesterChange={setSelectedSemester}
          onSubjectChange={setSelectedSubject}
          onContinue={() => {}}
        />
      </div>
    )
  }

  // Main exam creation form (Step 3 for personal syllabus or Step 4 for pre-uploaded syllabus)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => {
            if (syllabusType === "pre-uploaded" && (selectedBranch || selectedSemester || selectedSubject)) {
              setSelectedBranch("")
              setSelectedSemester("")
              setSelectedSubject("")
            } else {
              setSyllabusType(null)
            }
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Create New Exam</h1>
          <p className="text-gray-500 dark:text-gray-400">
            {examType === "personal" ? "Personal Use" : "Teacher Assignment"} •
            {syllabusType === "pre-uploaded"
              ? ` ${selectedSubject} (${selectedBranch}, ${selectedSemester})`
              : " Personal Syllabus"}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <p className="text-sm text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Exam Details</CardTitle>
          <CardDescription>Enter the basic information about your exam (* indicates required field)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Exam Title *</Label>
            <Input id="title" required readOnly={processingRequest} value={examTitle} aria-invalid={Boolean(fieldErrors.examTitle)} onChange={e=>{setExamTitle(e.target.value); clearFieldError("examTitle")}} placeholder="Enter exam title" />
            {fieldErrors.examTitle && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.examTitle}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea id="description" required readOnly={processingRequest} value={examDescription} aria-invalid={Boolean(fieldErrors.examDescription)} onChange={e=>{setExamDescription(e.target.value); clearFieldError("examDescription")}} placeholder="Enter exam description" />
            {fieldErrors.examDescription && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.examDescription}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="subject">Subject *</Label>
            <Input id="subject" required readOnly={processingRequest} value={subject} aria-invalid={Boolean(fieldErrors.subject)} onChange={e=>{setSubject(e.target.value); clearFieldError("subject")}} placeholder="e.g., Computer Science, Mathematics" />
            {fieldErrors.subject && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.subject}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="instructions">Instructions (Optional)</Label>
            <Textarea id="instructions" readOnly={processingRequest} value={instructions} onChange={e=>{setInstructions(e.target.value)}} placeholder="Enter exam instructions for students" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="duration">Duration (minutes) *</Label>
              <Input id="duration" type="number" required min="1" value={examDuration} readOnly={processingRequest} aria-invalid={Boolean(fieldErrors.duration)} onChange={e=>{setExamDuration(Number(e.target.value)); clearFieldError("duration")}} placeholder="60" />
              {fieldErrors.duration && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.duration}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="passing-score">Passing Score (%) *</Label>
              <Input id="passing-score" type="number" required value={passingPercentage} readOnly={processingRequest} aria-invalid={Boolean(fieldErrors.passingPercentage)} onChange={e=>{setPassingPercentage(Number(e.target.value)); clearFieldError("passingPercentage")}} placeholder="60" min="0" max="100" />
              {fieldErrors.passingPercentage && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.passingPercentage}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exam-degree">Degree/Program *</Label>
              <Input id="exam-degree" value={examDegree} required readOnly={processingRequest} aria-invalid={Boolean(fieldErrors.examDegree)} onChange={e=>{setExamDegree(e.target.value); clearFieldError("examDegree")}} placeholder="e.g., B.Tech, M.Sc, PhD" />
              {fieldErrors.examDegree && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.examDegree}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                id="negative-marking" 
                checked={negativeMarking}
                onChange={e => { setNegativeMarking(e.target.checked); clearFieldError("negativeMarkingPercentage") }}
                disabled={processingRequest}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="negative-marking" className="font-normal">
                Enable Negative Marking
              </Label>
            </div>
            {negativeMarking && (
              <div className="grid gap-2 ml-6">
                <Label htmlFor="negative-percentage">Negative Marking Percentage</Label>
                <Input 
                  id="negative-percentage" 
                  type="number" 
                  value={negativeMarkingPercentage} 
                  readOnly={processingRequest} 
                  required={negativeMarking}
                  aria-invalid={Boolean(fieldErrors.negativeMarkingPercentage)}
                  onChange={e=>{setNegativeMarkingPercentage(Number(e.target.value)); clearFieldError("negativeMarkingPercentage")}} 
                  placeholder="25" 
                  min="0" 
                  max="100"
                />
                {fieldErrors.negativeMarkingPercentage && (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.negativeMarkingPercentage}</p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Percentage of question marks to deduct for wrong answers
                </p>
              </div>
            )}
          </div>

          {syllabusType === "personal" && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              A syllabus file is not saved with this exam.
            </p>
          )}

          {examType === "teacher" && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="deadline">Submission Deadline</Label>
                <Input
                  id="deadline"
                  type="datetime-local"
                  value={deadline}
                  readOnly={processingRequest}
                  onChange={e=>{setDeadline(e.target.value)}}
                />
              </div>
              <StudentAssigneeSelector
                selectedIds={selectedStudentIds}
                onChange={setSelectedStudentIds}
                disabled={processingRequest}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* <Card>
        <CardHeader>
          <CardTitle>AI Evaluation Settings</CardTitle>
          <CardDescription>Configure how the AI will evaluate responses</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="evaluation-model">AI Model</Label>
            <Select defaultValue="gpt-4o">
              <SelectTrigger id="evaluation-model">
                <SelectValue placeholder="Select AI model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                <SelectItem value="gpt-4">GPT-4</SelectItem>
                <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="evaluation-criteria">Evaluation Criteria</Label>
            <Textarea
              id="evaluation-criteria"
              placeholder="Enter specific criteria for AI evaluation"
              defaultValue="Evaluate responses based on accuracy, completeness, and clarity. Award partial marks for partially correct answers."
            />
          </div>

          {examType === "teacher" && (
            <div className="grid gap-2">
              <Label>Bloom's Taxonomy Focus</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="remember" className="h-4 w-4 rounded border-gray-300" />
                  <label
                    htmlFor="remember"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Remember
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="understand" className="h-4 w-4 rounded border-gray-300" />
                  <label
                    htmlFor="understand"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Understand
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="apply" className="h-4 w-4 rounded border-gray-300" />
                  <label
                    htmlFor="apply"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Apply
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="analyze" className="h-4 w-4 rounded border-gray-300" />
                  <label
                    htmlFor="analyze"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Analyze
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="evaluate" className="h-4 w-4 rounded border-gray-300" />
                  <label
                    htmlFor="evaluate"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Evaluate
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input type="checkbox" id="create" className="h-4 w-4 rounded border-gray-300" />
                  <label
                    htmlFor="create"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Create
                  </label>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card> */}

      <QuestionEditor
        questions={questions}
        processingRequest={processingRequest}
        onAdd={addQuestion}
        onRemove={removeQuestion}
        onUpdate={updateQuestion}
      />
      <div className="flex justify-between items-start gap-4">
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            disabled
            title="Draft saving is not available: the exam API has no draft mode, so drafts cannot be stored yet"
          >
            Save as Draft
          </Button>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Draft saving is not available yet; use Create Exam to save.
          </p>
        </div>
        <Button
          type="submit"
          disabled={processingRequest}
        >
          {processingRequest ? "Creating..." : "Create Exam"}
        </Button>
      </div>
      </form>
    </div>
  )
}
