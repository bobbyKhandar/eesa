"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { RadioGroup, RadioGroupItem } from "@/frontend/components/ui/radio-group"
import { ArrowLeft, Plus, Trash2, Upload, BookOpen, Users, FileText } from "lucide-react"

export default function CreateExamPage() {
  const [examType, setExamType] = useState<string | null>(null)
  const [syllabusType, setSyllabusType] = useState<string | null>(null)
  const [selectedBranch, setSelectedBranch] = useState("")
  const [selectedSemester, setSelectedSemester] = useState("")
  const [selectedSubject, setSelectedSubject] = useState("")
  const [questions, setQuestions] = useState<Array<{
    id: number;
    type: string;
    text: string;
    marks: number;
    questionType: "TEXT" | "MCQ" | "TRUE_FALSE";
    answer?: string;
    options?: string[];
    correctOption?: number;
  }>>([
    { id: 1, type: "theory", text: "", marks: 10, questionType: "TEXT", answer: "" },
  ])
  // Mock data for branches, semesters, and subjects
  const branches = ["Computer Science", "Electrical Engineering", "Mechanical Engineering", "Civil Engineering"]
  const semesters = [
    "Semester 1",
    "Semester 2",
    "Semester 3",
    "Semester 4",
    "Semester 5",
    "Semester 6",
    "Semester 7",
    "Semester 8",
  ]
  const subjects = {
    "Computer Science": {
      "Semester 1": ["Introduction to Programming", "Digital Logic", "Mathematics I"],
      "Semester 2": ["Data Structures", "Computer Organization", "Mathematics II"],
      // Add more semesters and subjects as needed
    },
    "Electrical Engineering": {
      "Semester 1": ["Basic Electrical Engineering", "Physics", "Mathematics I"],
      "Semester 2": ["Circuit Theory", "Electronics", "Mathematics II"],
      // Add more branches as needed
    },
    // Add more branches as needed
  }

  const addQuestion = (type: string) => {
    const newId = questions.length > 0 ? Math.max(...questions.map((q) => q.id)) + 1 : 1
    if (type === "theory") {
      setQuestions([...questions, { 
        id: newId, 
        type: "theory", 
        text: "", 
        marks: 10, 
        questionType: "TEXT",
        answer: ""
      }])
    } else if (type === "mcq") {
      setQuestions([...questions, { 
        id: newId, 
        type: "mcq", 
        text: "", 
        options: ["", "", "", ""], 
        correctOption: 0, 
        marks: 5,
        questionType: "MCQ",
        answer: ""
      }])
    }
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
  const [processingRequest,setProcessingRequest]=useState<boolean>(false)
  const [error,setError]=useState<string>("")
  const [success,setSuccess]=useState<string>("")

  const removeQuestion = (id: number) => {
    setQuestions(questions.filter((q) => q.id !== id))
  }

  const updateQuestion = (id: number, data: any) => {
    setQuestions(questions.map((q) => (q.id === id ? { ...q, ...data } : q)))
  }

  interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
  examId?: string;
}

async function uploadExamSet(): Promise<ApiResponse> {
  try {
    // Validate required fields
    if (!examTitle || !examDescription || !subject || !examDegree) {
      setError("Please fill in all required fields")
      return { success: false, error: "Missing required fields" }
    }

    if (questions.length === 0) {
      setError("Please add at least one question")
      return { success: false, error: "No questions added" }
    }

    // Validate all questions have text and marks
    for (const q of questions) {
      if (!q.text || q.marks <= 0) {
        setError("All questions must have text and positive marks")
        return { success: false, error: "Invalid question data" }
      }
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
      instructions,
      negativeMarking,
      negativeMarkingPercentage: negativeMarking ? negativeMarkingPercentage : undefined,
      examMaxMarks: totalMarks,
      examUsers: [],
      questions: questions.map(q => ({
        text: q.text,
        marks: q.marks,
        type: q.questionType || "TEXT"
      }))
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
            <CardDescription>Choose how you want to use this exam</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card
                className={`cursor-pointer border-2 hover:border-primary hover:bg-primary/5`}
                onClick={() => setExamType("personal")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    Personal Use
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Create an exam for your personal study or practice. You'll be the only one taking this exam.
                  </p>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer border-2 hover:border-primary hover:bg-primary/5`}
                onClick={() => setExamType("teacher")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Teacher Assignment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Create an exam to assign to students. You'll be able to share this exam and collect responses.
                  </p>
                </CardContent>
              </Card>
            </div>
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
            <CardDescription>
              {examType === "personal"
                ? "Choose which syllabus to use for your personal exam"
                : "Choose which syllabus to use for your student assignment"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card
                className={`cursor-pointer border-2 hover:border-primary hover:bg-primary/5`}
                onClick={() => setSyllabusType("pre-uploaded")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Pre-uploaded Syllabus
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Use an existing syllabus from our database for a specific subject.
                  </p>
                </CardContent>
              </Card>

              <Card
                className={`cursor-pointer border-2 hover:border-primary hover:bg-primary/5`}
                onClick={() => setSyllabusType("personal")}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="h-5 w-5" />
                    Personal Syllabus
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Upload or create your own custom syllabus for this exam.
                  </p>
                </CardContent>
              </Card>
            </div>
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

        <Card>
          <CardHeader>
            <CardTitle>Choose Subject from Syllabus</CardTitle>
            <CardDescription>Select the branch, semester, and subject for your exam</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="branch">Branch</Label>
                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                  <SelectTrigger id="branch">
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="semester">Semester</Label>
                <Select value={selectedSemester} onValueChange={setSelectedSemester} disabled={!selectedBranch}>
                  <SelectTrigger id="semester">
                    <SelectValue placeholder="Select semester" />
                  </SelectTrigger>
                  <SelectContent>
                    {semesters.map((semester) => (
                      <SelectItem key={semester} value={semester}>
                        {semester}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="subject">Subject</Label>
                <Select
                  value={selectedSubject}
                  onValueChange={setSelectedSubject}
                  disabled={!selectedBranch || !selectedSemester}
                >
                  <SelectTrigger id="subject">
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedBranch &&
                      selectedSemester &&
                      subjects[selectedBranch]?.[selectedSemester]?.map((subject) => (
                        <SelectItem key={subject} value={subject}>
                          {subject}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              disabled={!selectedBranch || !selectedSemester || !selectedSubject}
              onClick={() => {
                // Continue to the main exam creation form
                // The selected branch, semester, and subject are stored in state
              }}
            >
              Continue
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  // Main exam creation form (Step 3 for personal syllabus or Step 4 for pre-uploaded syllabus)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
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

      <Card>
        <CardHeader>
          <CardTitle>Exam Details</CardTitle>
          <CardDescription>Enter the basic information about your exam (* indicates required field)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Exam Title *</Label>
            <Input id="title" required readOnly={processingRequest} value={examTitle} onChange={e=>{setExamTitle(e.target.value)}} placeholder="Enter exam title" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea id="description" required readOnly={processingRequest} value={examDescription} onChange={e=>{setExamDescription(e.target.value)}} placeholder="Enter exam description" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="subject">Subject *</Label>
            <Input id="subject" required readOnly={processingRequest} value={subject} onChange={e=>{setSubject(e.target.value)}} placeholder="e.g., Computer Science, Mathematics" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="instructions">Instructions (Optional)</Label>
            <Textarea id="instructions" readOnly={processingRequest} value={instructions} onChange={e=>{setInstructions(e.target.value)}} placeholder="Enter exam instructions for students" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input id="duration" type="number" required value={examDuration} readOnly={processingRequest} onChange={e=>{setExamDuration(Number(e.target.value))}} placeholder="60" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="passing-score">Passing Score (%) *</Label>
              <Input id="passing-score" type="number" required value={passingPercentage} readOnly={processingRequest} onChange={e=>{setPassingPercentage(Number(e.target.value))}} placeholder="60" min="0" max="100" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exam-degree">Degree/Program *</Label>
              <Input id="exam-degree" value={examDegree} required readOnly={processingRequest} onChange={e=>{setExamDegree(e.target.value)}} placeholder="e.g., B.Tech, M.Sc, PhD" />
            </div>
          </div>

          <div className="grid gap-4">
            <div className="flex items-center space-x-2">
              <input 
                type="checkbox" 
                id="negative-marking" 
                checked={negativeMarking}
                onChange={e => setNegativeMarking(e.target.checked)}
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
                  onChange={e=>{setNegativeMarkingPercentage(Number(e.target.value))}} 
                  placeholder="25" 
                  min="0" 
                  max="100"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Percentage of question marks to deduct for wrong answers
                </p>
              </div>
            )}
          </div>

          {syllabusType === "personal" && (
            <div className="grid gap-2">
              <Label htmlFor="syllabus">Upload Syllabus (Optional)</Label>
              <div className="flex items-center gap-2">
                <Input id="syllabus" type="file" className="flex-1" />
                <Button variant="outline" size="sm">
                  <Upload className="h-4 w-4 mr-2" /> Upload
                </Button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Upload a PDF or document file containing your syllabus
              </p>
            </div>
          )}

          {examType === "teacher" && (
            <div className="grid gap-2">
              <Label htmlFor="deadline">Submission Deadline</Label>
              <Input id="deadline" type="datetime-local" />
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Questions</CardTitle>
            <CardDescription>
              Add and configure exam questions • Total Marks: {questions.reduce((sum, q) => sum + (q.marks || 0), 0)}
            </CardDescription>
          </div>
          <Tabs defaultValue="theory">
            <TabsList>
              <TabsTrigger value="theory">theory</TabsTrigger>
              {/* <TabsTrigger value="mcq">Multiple Choice</TabsTrigger> */}
            </TabsList>
            <TabsContent value="theory">
              <Button onClick={() => addQuestion("theory")} size="sm" className="gap-1">
                <Plus className="h-4 w-4" /> Add theory Question
              </Button>
            </TabsContent>
            {/* <TabsContent value="mcq">
              <Button onClick={() => addQuestion("mcq")} size="sm" className="gap-1">
                <Plus className="h-4 w-4" /> Add MCQ
              </Button>
            </TabsContent> */}
          </Tabs>
        </CardHeader>
        <CardContent className="space-y-6">
          {questions.map((question, index) => (
            <Card key={question.id} className="border border-gray-200 dark:border-gray-800">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Question {index + 1}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => removeQuestion(question.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor={`question-${question.id}`}>Question Text</Label>
                  <Textarea
                    id={`question-${question.id}`}
                    placeholder="Enter question text"
                    value={question.text}
                    readOnly={processingRequest}
                    onChange={(e) => updateQuestion(question.id, { text: e.target.value })}
                  />
                </div>

                {/* {question.type === "mcq" && (
                  <div className="space-y-4">
                    <Label>Options</Label>
                    {question.options.map((option, optIndex) => (
                      <div key={optIndex} className="flex items-center gap-2">
                        <Input
                          placeholder={`Option ${optIndex + 1}`}
                          value={option}
                          readOnly={processingRequest}
                          onChange={(e) => {
                            const newOptions = [...question.options]
                            newOptions[optIndex] = e.target.value
                            updateQuestion(question.id, { options: newOptions })
                          }}
                        />
                        <Select
                          value={question.correctOption === optIndex.toString() ? "correct" : "incorrect"}
                          onValueChange={(value) => {
                            if (value === "correct") {
                              updateQuestion(question.id, { correctOption: optIndex.toString() })
                            }
                          }}
                        >

                          <SelectTrigger className="w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="correct">Correct</SelectItem>
                            <SelectItem value="incorrect">Incorrect</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                )} */}

                <div className="grid gap-2">
                  <Label htmlFor={`marks-${question.id}`}>Marks</Label>
                  <Input
                    id={`marks-${question.id}`}
                    type="number"
                    value={question.marks}
                    onChange={(e) => updateQuestion(question.id, { marks: Number.parseInt(e.target.value) || 0 })}
                  />
                </div>

                {/* {examType === "teacher" && (
                  <div className="grid gap-2">
                    <Label>Bloom's Taxonomy Level</Label>
                    <RadioGroup defaultValue="understand">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="remember" id="remember" />
                          <Label htmlFor="remember">Remember</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="understand" id="understand" />
                          <Label htmlFor="understand">Understand</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="apply" id="apply" />
                          <Label htmlFor="apply">Apply</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="analyze" id="analyze" />
                          <Label htmlFor="analyze">Analyze</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="evaluate" id="evaluate" />
                          <Label htmlFor="evaluate">Evaluate</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="create" id="create" />
                          <Label htmlFor="create">Create</Label>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>
                )} */}
              </CardContent>
            </Card>
          ))}

          {questions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">No questions added yet</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Use the buttons above to add questions</p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" disabled={processingRequest}>Save as Draft</Button>
          <Button 
            onClick={async () => {
              const response = await uploadExamSet()
              if (response.success) {
                // Optionally redirect to exam list or show success message
                setTimeout(() => {
                  window.location.href = '/dashboard/exams'
                }, 2000)
              }
            }}
            disabled={processingRequest}
          >
            {processingRequest ? "Creating..." : "Create Exam"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
