"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ArrowLeft, ArrowRight, Clock, AlertCircle } from "lucide-react"

export default function TakeExamPage({ params }: { params: { id: string } }) {
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [timeLeft, setTimeLeft] = useState(3600) // 60 minutes in seconds

  // Mock exam data
  const exam = {
    id: params.id,
    title: "Introduction to AI",
    description: "This exam tests fundamental concepts in artificial intelligence.",
    duration: 60, // minutes
    questions: [
      {
        id: 1,
        type: "essay",
        text: "Explain the difference between supervised and unsupervised learning in machine learning.",
        marks: 10,
      },
      {
        id: 2,
        type: "mcq",
        text: "Which of the following is NOT a type of machine learning?",
        options: ["Supervised Learning", "Unsupervised Learning", "Reinforcement Learning", "Deterministic Learning"],
        correctOption: 3,
        marks: 5,
      },
      {
        id: 3,
        type: "essay",
        text: "Describe how neural networks mimic the human brain and provide an example of their application.",
        marks: 15,
      },
      {
        id: 4,
        type: "mcq",
        text: "What is the primary goal of clustering algorithms?",
        options: [
          "To predict outcomes based on labeled data",
          "To group similar data points together",
          "To maximize rewards in an environment",
          "To minimize computational complexity",
        ],
        correctOption: 1,
        marks: 5,
      },
      {
        id: 5,
        type: "essay",
        text: "Discuss the ethical implications of using AI in automated decision-making systems.",
        marks: 20,
      },
    ],
  }

  const handleAnswerChange = (value: string) => {
    setAnswers({
      ...answers,
      [exam.questions[currentQuestion].id]: value,
    })
  }

  const handleNext = () => {
    if (currentQuestion < exam.questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1)
    }
  }

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1)
    }
  }

  const handleSubmit = () => {
    // In a real app, this would submit the exam answers for AI evaluation
    alert("Exam submitted for AI evaluation!")
  }

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`
  }

  const currentQuestionData = exam.questions[currentQuestion]
  const progress = ((currentQuestion + 1) / exam.questions.length) * 100

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{exam.title}</h1>
            <p className="text-gray-500 dark:text-gray-400">
              Question {currentQuestion + 1} of {exam.questions.length}
            </p>
          </div>
          <div className="flex items-center gap-2 bg-white dark:bg-gray-800 px-4 py-2 rounded-md shadow">
            <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            <span className="font-medium">{formatTime(timeLeft)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-2" />
          <span className="text-sm text-gray-500 dark:text-gray-400">{Math.round(progress)}%</span>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Question {currentQuestion + 1}</CardTitle>
            <CardDescription>
              {currentQuestionData.type === "essay" ? "Essay Question" : "Multiple Choice Question"} •{" "}
              {currentQuestionData.marks} marks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-lg font-medium">{currentQuestionData.text}</div>

            {currentQuestionData.type === "essay" ? (
              <Textarea
                placeholder="Type your answer here..."
                className="min-h-[200px]"
                value={answers[currentQuestionData.id] || ""}
                onChange={(e) => handleAnswerChange(e.target.value)}
              />
            ) : (
              <RadioGroup value={answers[currentQuestionData.id] || ""} onValueChange={handleAnswerChange}>
                {currentQuestionData.options?.map((option, index) => (
                  <div
                    key={index}
                    className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <RadioGroupItem value={index.toString()} id={`option-${index}`} />
                    <Label htmlFor={`option-${index}`} className="flex-1 cursor-pointer">
                      {option}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={handlePrevious} disabled={currentQuestion === 0}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Previous
            </Button>

            {currentQuestion < exam.questions.length - 1 ? (
              <Button onClick={handleNext}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleSubmit}>Submit Exam</Button>
            )}
          </CardFooter>
        </Card>

        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
          {exam.questions.map((_, index) => (
            <Button
              key={index}
              variant={index === currentQuestion ? "default" : answers[exam.questions[index].id] ? "outline" : "ghost"}
              className="h-10 w-10"
              onClick={() => setCurrentQuestion(index)}
            >
              {index + 1}
            </Button>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm">Important Notes</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="list-disc pl-5 space-y-1">
              <li>Your answers are automatically saved as you type.</li>
              <li>You can navigate between questions using the buttons above.</li>
              <li>Once submitted, your answers will be evaluated by our AI system.</li>
              <li>You cannot return to the exam after submission.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
