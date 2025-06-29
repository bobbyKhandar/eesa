"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Upload,
  BookOpen,
  Users,
  FileText,
} from "lucide-react";

export default function CreateExamPage() {
  const [examType, setExamType] = useState<string | null>(null);
  const [syllabusType, setSyllabusType] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [selectedSemester, setSelectedSemester] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [showLLMInput, setShowLLMInput] = useState(false);
  const [llmPrompt, setLlmPrompt] = useState("");
  const [llmquestionsweightage, setllmquestionsweightage] = useState(
    "50% 5 marks , 50% 10 marks"
  );
  const [llmQuestionQuantity, setllmQuestionQuantity] = useState(10);
  const [questions, setQuestions] = useState([
    { id: 1, type: "essay", text: "", marks: 10 },
    {
      id: 2,
      type: "mcq",
      text: "",
      options: ["", "", "", ""],
      correctOption: 0,
      marks: 5,
    },
  ]);

  // Mock data for branches, semesters, and subjects
  const branches = [
    "Computer Science",
    "Electrical Engineering",
    "Mechanical Engineering",
    "Civil Engineering",
  ];
  const semesters = [
    "Semester 1",
    "Semester 2",
    "Semester 3",
    "Semester 4",
    "Semester 5",
    "Semester 6",
    "Semester 7",
    "Semester 8",
  ];
  const subjects = {
    "Computer Science": {
      "Semester 1": [
        "Introduction to Programming",
        "Digital Logic",
        "Mathematics I",
      ],
      "Semester 2": [
        "Data Structures",
        "Computer Organization",
        "Mathematics II",
      ],
      // Add more semesters and subjects as needed
    },
    "Electrical Engineering": {
      "Semester 1": [
        "Basic Electrical Engineering",
        "Physics",
        "Mathematics I",
      ],
      "Semester 2": ["Circuit Theory", "Electronics", "Mathematics II"],
      // Add more branches as needed
    },
    // Add more branches as needed
  };

  const addQuestion = (type: string) => {
    const newId =
      questions.length > 0 ? Math.max(...questions.map((q) => q.id)) + 1 : 1;

    if (type === "essay") {
      setQuestions([...questions, { id: newId, type, text: "", marks: 10 }]);
    } else if (type === "mcq") {
      setQuestions([
        ...questions,
        {
          id: newId,
          type,
          text: "",
          options: ["", "", "", ""],
          correctOption: 0,
          marks: 5,
        },
      ]);
    }
  };

  const removeQuestion = (id: number) => {
    setQuestions(questions.filter((q) => q.id !== id));
  };

  const updateQuestion = (id: number, data: any) => {
    setQuestions(questions.map((q) => (q.id === id ? { ...q, ...data } : q)));
  };

  // Step 1: Select exam type (Personal Use or Teacher Assignment)
  if (!examType) {
    return (
      <div>
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
            <CardDescription>
              Choose how you want to use this exam
            </CardDescription>
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
                    Create an exam for your personal study or practice. You'll
                    be the only one taking this exam.
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
                    Create an exam to assign to students. You'll be able to
                    share this exam and collect responses.
                  </p>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: Select syllabus type (Pre-uploaded or Personal)
  if (!syllabusType) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setExamType(null)}
          >
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
                    Use an existing syllabus from our database for a specific
                    subject.
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
    );
  }

  // Step 3: If pre-uploaded syllabus, select branch, semester, and subject
  if (
    syllabusType === "pre-uploaded" &&
    (!selectedBranch || !selectedSemester || !selectedSubject)
  ) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSyllabusType(null)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold">Select Subject</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Choose Subject from Syllabus</CardTitle>
            <CardDescription>
              Select the branch, semester, and subject for your exam
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="branch">Branch</Label>
                <Select
                  value={selectedBranch}
                  onValueChange={setSelectedBranch}
                >
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
                <Select
                  value={selectedSemester}
                  onValueChange={setSelectedSemester}
                  disabled={!selectedBranch}
                >
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
                      subjects[selectedBranch]?.[selectedSemester]?.map(
                        (subject) => (
                          <SelectItem key={subject} value={subject}>
                            {subject}
                          </SelectItem>
                        )
                      )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              disabled={
                !selectedBranch || !selectedSemester || !selectedSubject
              }
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
    );
  }

  // Main exam creation form (Step 3 for personal syllabus or Step 4 for pre-uploaded syllabus)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            if (
              syllabusType === "pre-uploaded" &&
              (selectedBranch || selectedSemester || selectedSubject)
            ) {
              setSelectedBranch("");
              setSelectedSemester("");
              setSelectedSubject("");
            } else {
              setSyllabusType(null);
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

      <Card>
        <CardHeader>
          <CardTitle>Exam Details</CardTitle>
          <CardDescription>
            Enter the basic information about your exam
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Exam Title</Label>
            <Input id="title" placeholder="Enter exam title" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" placeholder="Enter exam description" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="duration">Duration (minutes)</Label>
              <Input id="duration" type="number" placeholder="60" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="passing-score">Passing Score (%)</Label>
              <Input id="passing-score" type="number" placeholder="60" />
            </div>
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

      <Card>
        <CardHeader>
          <CardTitle>AI Evaluation Settings</CardTitle>
          <CardDescription>
            Configure how the AI will evaluate responses
          </CardDescription>
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
                  <input
                    type="checkbox"
                    id="remember"
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label
                    htmlFor="remember"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Remember
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="understand"
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label
                    htmlFor="understand"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Understand
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="apply"
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label
                    htmlFor="apply"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Apply
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="analyze"
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label
                    htmlFor="analyze"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Analyze
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="evaluate"
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label
                    htmlFor="evaluate"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Evaluate
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="create"
                    className="h-4 w-4 rounded border-gray-300"
                  />
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
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 my-10">
          <div className="flex flex-row items-center justify-between w-full">
            <div>
              <CardTitle>Questions</CardTitle>
              <CardDescription>
                Add and configure exam questions
              </CardDescription>
            </div>
            <div className="flex flex-row justify-between items-center gap-4">
              <Button
                onClick={() => setShowLLMInput(!showLLMInput)}
                size="sm"
                className="gap-4 mx-20"
              >
                <Plus className="h-4 w-4" /> Add Questions Using LLM
              </Button>

              <Tabs defaultValue="essay">
                <TabsList>
                  <TabsTrigger value="essay">Essay</TabsTrigger>
                  <TabsTrigger value="mcq">Multiple Choice</TabsTrigger>
                </TabsList>
                <TabsContent value="essay">
                  <Button
                    onClick={() => addQuestion("essay")}
                    size="sm"
                    className="gap-1"
                  >
                    <Plus className="h-4 w-4" /> Add Essay Question
                  </Button>
                </TabsContent>
                <TabsContent value="mcq">
                  <Button
                    onClick={() => addQuestion("mcq")}
                    size="sm"
                    className="gap-1"
                  >
                    <Plus className="h-4 w-4" /> Add MCQ
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
          </div>

          {showLLMInput && (
            <div className="flex items-center gap-2 w-full">
              <div>
                <Label>
                  Describe the type of question you want alongside the number of
                  questions along side the weightage percentage
                </Label>
                <Input
                  placeholder="Describe the type of question you want alongside the number of questions along side the weightage percentage"
                  value={llmPrompt}
                  onChange={(e) => setLlmPrompt(e.target.value)}
                  className="flex-1"
                />
              </div>
              <div>
                <Label>
                  enter the weightage of the questions for eg: 50%:5 marks
                  ,30%:10 marks,20%:15 marks
                </Label>
                <Input
                  placeholder="Describe the type of question you want alongside the number of questions along side the weightage percentage"
                  value={llmquestionsweightage}
                  onChange={(e) => setllmquestionsweightage(e.target.value)}
                  className="flex-1"
                />
              </div>
              <div>
                <Label>Number of total questions</Label>
                <Input
                  placeholder="Describe the type of question you want alongside the number of questions "
                  value={llmQuestionQuantity}
                  type="number"
                  onChange={(e) => setllmQuestionQuantity(e.target.value)}
                  className="flex-1"
                />
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  // await addQuestion("llm", llmPrompt);
                  setShowLLMInput(false);
                  setLlmPrompt("");
                }}
              >
                Generate
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-6">
          {questions.map((question, index) => (
            <Card
              key={question.id}
              className="border border-gray-200 dark:border-gray-800"
            >
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  Question {index + 1}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeQuestion(question.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor={`question-${question.id}`}>
                    Question Text
                  </Label>
                  <Textarea
                    id={`question-${question.id}`}
                    placeholder="Enter question text"
                    value={question.text}
                    onChange={(e) =>
                      updateQuestion(question.id, { text: e.target.value })
                    }
                  />
                </div>

                {question.type === "mcq" && (
                  <div className="space-y-4">
                    <Label>Options</Label>
                    {question.options.map((option, optIndex) => (
                      <div key={optIndex} className="flex items-center gap-2">
                        <Input
                          placeholder={`Option ${optIndex + 1}`}
                          value={option}
                          onChange={(e) => {
                            const newOptions = [...question.options];
                            newOptions[optIndex] = e.target.value;
                            updateQuestion(question.id, {
                              options: newOptions,
                            });
                          }}
                        />
                        <Select
                          value={
                            question.correctOption === optIndex
                              ? "correct"
                              : "incorrect"
                          }
                          onValueChange={(value) => {
                            if (value === "correct") {
                              updateQuestion(question.id, {
                                correctOption: optIndex,
                              });
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
                )}

                <div className="grid gap-2">
                  <Label htmlFor={`marks-${question.id}`}>Marks</Label>
                  <Input
                    id={`marks-${question.id}`}
                    type="number"
                    value={question.marks}
                    onChange={(e) =>
                      updateQuestion(question.id, {
                        marks: Number.parseInt(e.target.value) || 0,
                      })
                    }
                  />
                </div>

                {examType === "teacher" && (
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
                )}
              </CardContent>
            </Card>
          ))}

          {questions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                No questions added yet
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Use the buttons above to add questions
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline">Save as Draft</Button>
          <Button>Create Exam</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
