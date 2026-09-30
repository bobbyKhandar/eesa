"use client"

import { useCallback, useEffect, useRef, useState, use } from "react"
import React from "react"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Textarea } from "@/frontend/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/frontend/components/ui/radio-group"
import { Label } from "@/frontend/components/ui/label"
import { Progress } from "@/frontend/components/ui/progress"
import { ArrowLeft, ArrowRight, Clock, AlertCircle } from "lucide-react"
import { useUser } from "@clerk/nextjs"
import { examTimeLimitSeconds } from "@/frontend/lib/examResults"

export default function TakeExamPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  const examId = resolvedParams.id
  const { user } = useUser()

  const [exam, setExam] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [timeLeft, setTimeLeft] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // The countdown and the answers are read by the timer and by the submit
  // handler, both of which outlive a single render. Holding them in refs is
  // what lets the interval be created once instead of being torn down and
  // rebuilt every second, and what keeps a submit from sending an answer that
  // was typed in the final second.
  const examRef = useRef<any>(null)
  const answersRef = useRef<Record<string, string>>({})
  const timeLeftRef = useRef(0)
  const startTimeRef = useRef<number | null>(null)
  const submittingRef = useRef(false)

  useEffect(() => {
    // STEP 1: TEST API CALL WITH SIMPLE FETCH
    const fetchExam = async () => {
      try {
        setLoading(true)
        console.log('STEP 1: Fetching exam with ID:', examId)
        const response = await fetch(`/api/exams/${encodeURIComponent(examId)}`)
        console.log('STEP 1: Response status:', response.status, response.ok)
        
        const data = await response.json()
        console.log('STEP 1: Response data:', data)

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to fetch exam')
        }

        console.log('STEP 1: Exam data received successfully')
        setExam(data.exam)
        examRef.current = data.exam

        // Same rule the submit route applies to `timeSpent`: the limit comes
        // from the exam's duration, and only a missing/zero duration falls back
        // to the default.
        const limit = examTimeLimitSeconds(data.exam?.duration)
        timeLeftRef.current = limit
        setTimeLeft(limit)

        const startedAt = Date.now()
        startTimeRef.current = startedAt
      } catch (err: any) {
        console.error('STEP 1: Error fetching exam:', err)
        setError(err.message || 'Failed to load exam')
      } finally {
        setLoading(false)
      }
    }

    // A new exam id means a new attempt: drop the previous one completely.
    examRef.current = null
    answersRef.current = {}
    startTimeRef.current = null
    timeLeftRef.current = 0
    submittingRef.current = false
    setAnswers({})
    setCurrentQuestion(0)
    setSubmitting(false)
    setSubmitError(null)

    if (examId) {
      fetchExam()
    }

    // STATIC DATA COMMENTED OUT FOR NOW
    /*
    const staticExamData = {
      _id: examId,
      examTitle: "Operating Systems Final Exam",
      examDescription: "Comprehensive exam covering all OS topics",
      subject: "Operating Systems",
      duration: 60, // minutes
      examMaxMarks: 50,
      instructions: "Answer all questions. Show your work for full credit. No external resources allowed.",
      negativeMarking: true,
      questions: [
        {
          _id: "q1",
          questionText: "Explain the difference between process and thread. Provide examples.",
          questionType: "TEXT",
          marks: 10
        },
        {
          _id: "q2",
          questionText: "What is a deadlock? Describe the four necessary conditions for deadlock to occur.",
          questionType: "TEXT",
          marks: 10
        },
        {
          _id: "q3",
          questionText: "Which scheduling algorithm has the lowest average waiting time?",
          questionType: "MCQ",
          marks: 5,
          options: [
            { text: "FCFS (First Come First Serve)" },
            { text: "SJF (Shortest Job First)" },
            { text: "Round Robin" },
            { text: "Priority Scheduling" }
          ]
        },
        {
          _id: "q4",
          questionText: "Explain virtual memory and its benefits.",
          questionType: "TEXT",
          marks: 10
        },
        {
          _id: "q5",
          questionText: "What is thrashing in operating systems?",
          questionType: "MCQ",
          marks: 5,
          options: [
            { text: "When CPU utilization is very high" },
            { text: "When excessive paging operations occur" },
            { text: "When process scheduling is inefficient" },
            { text: "When memory is fully utilized" }
          ]
        },
        {
          _id: "q6",
          questionText: "Describe the producer-consumer problem and how semaphores can solve it.",
          questionType: "TEXT",
          marks: 10
        }
      ]
    };

    // STATIC DATA - Set static data immediately
    setLoading(true);
    setTimeout(() => {
      setExam(staticExamData);
      examRef.current = staticExamData;
      timeLeftRef.current = examTimeLimitSeconds(staticExamData.duration);
      setTimeLeft(timeLeftRef.current);
      startTimeRef.current = Date.now();
      setLoading(false);
    }, 500); // Small delay to simulate loading
    */

  }, [examId])

  /**
   * Send the attempt. `autoSubmitted` is decided by the caller - the countdown
   * reaching zero - rather than by reading a countdown captured earlier, which
   * is why timed-out attempts used to be stored as ordinary submissions.
   */
  const submitExam = useCallback(async (autoSubmitted: boolean) => {
    const currentExam = examRef.current
    if (!currentExam?.questions?.length) return
    // A second click (or a click while the timer fires) must not grade twice.
    if (submittingRef.current) return
    if (!user?.id) {
      setSubmitError('Your session is still loading. Try submitting again in a moment.')
      return
    }
    if (startTimeRef.current === null) return

    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)

    const timeSpent = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000))

    try {
      // Prepare responses in the format expected by the API
      const responses = currentExam.questions.map((q: any) => {
        const questionId = String(q._id ?? q.id ?? '')
        return {
          questionId: questionId,
          userResponse: answersRef.current[questionId] || '',
          allottedMarks: 0, // Will be filled by AI evaluation
          maxMarks: q.marks,
          feedback: '',
          suggestions: []
        }
      })

      const submissionData = {
        examId: examId,
        responses: responses,
        timeSpent: timeSpent,
        autoSubmit: autoSubmitted
      }

      const response = await fetch('/api/submissions/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submissionData),
      })

      const data = await response.json().catch(() => null)

      if (response.ok && data?.success) {
        // Redirect to results page
        window.location.href = `/results/${data.submissionId}`
        return
      }

      // Already submitted: show the result that exists instead of a dead end.
      if (response.status === 409 && data?.submissionId) {
        window.location.href = `/results/${data.submissionId}`
        return
      }

      setSubmitError(data?.error || 'Failed to submit exam')
    } catch (err: any) {
      console.error('Error submitting exam:', err)
      setSubmitError('Failed to submit exam. Please try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [examId, user?.id])

  // Timer countdown. One interval for the whole attempt: the previous version
  // listed `timeLeft` in its dependencies, so the interval was cleared and
  // recreated every second, and the auto-submit ran from inside a `setState`
  // updater - a function React may invoke more than once.
  useEffect(() => {
    if (!exam) return

    const timer = setInterval(() => {
      if (submittingRef.current) return

      const remaining = Math.max(0, timeLeftRef.current - 1)
      timeLeftRef.current = remaining
      setTimeLeft(remaining)

      if (remaining === 0) {
        void submitExam(true)
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [exam, submitExam])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500 dark:text-gray-400">Loading exam...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (error || !exam) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-red-500">{error || 'Exam not found'}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // An exam whose questions all lost their prompt comes back with an empty
  // list; the question card below indexed into it unconditionally and threw.
  if (!exam.questions?.length) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <Card>
            <CardContent className="py-12 text-center space-y-2">
              <p className="text-gray-500 dark:text-gray-400">
                This exam has no questions available.
              </p>
              <Button variant="outline" onClick={() => { window.location.href = '/dashboard' }}>
                Back to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const currentQuestionData = exam.questions[currentQuestion]
  const currentQuestionId = String(currentQuestionData?._id ?? currentQuestionData?.id ?? '')

  const handleAnswerChange = (value: string) => {
    answersRef.current = { ...answersRef.current, [currentQuestionId]: value }
    setAnswers(answersRef.current)
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
    void submitExam(false)
  }

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`
  }

  const progress = ((currentQuestion + 1) / exam.questions.length) * 100
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{exam.examTitle}</h1>
            <p className="text-gray-500 dark:text-gray-400">
              Question {currentQuestion + 1} of {exam.questions.length}
            </p>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-md shadow ${
            timeLeft < 300 ? 'bg-red-100 dark:bg-red-900/20' : 'bg-white dark:bg-gray-800'
          }`}>
            <Clock className={`h-4 w-4 ${timeLeft < 300 ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`} />
            <span className={`font-medium ${timeLeft < 300 ? 'text-red-500' : ''}`}>{formatTime(timeLeft)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-2" />
          <span className="text-sm text-gray-500 dark:text-gray-400">{Math.round(progress)}%</span>
        </div>

        {exam.instructions && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Instructions</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p>{exam.instructions}</p>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Question {currentQuestion + 1}</CardTitle>
            <CardDescription>
              {currentQuestionData.questionType === "TEXT" ? "Essay Question" : "Multiple Choice Question"} •{" "}
              {currentQuestionData.marks} marks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-lg font-medium">{currentQuestionData.questionText}</div>

            {currentQuestionData.questionType === "TEXT" ? (
              <Textarea
                placeholder="Type your answer here..."
                className="min-h-[200px]"
                value={answers[currentQuestionId] || ""}
                onChange={(e) => handleAnswerChange(e.target.value)}
              />
            ) : (
              <RadioGroup value={answers[currentQuestionId] || ""} onValueChange={handleAnswerChange}>
                {currentQuestionData.options?.map((option: any, index: number) => {
                  const optionLabel = typeof option === "string" ? option : (option.text || "")
                  const optionValue = optionLabel || index.toString()
                  return (
                  <div
                    key={index}
                    className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <RadioGroupItem value={optionValue} id={`option-${index}`} />
                    <Label htmlFor={`option-${index}`} className="flex-1 cursor-pointer">
                      {optionLabel || option}
                    </Label>
                  </div>
                  )
                })}
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
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Exam'}
              </Button>
            )}
          </CardFooter>
        </Card>

        {submitError && (
          <Card className="border-red-300 dark:border-red-800">
            <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
              {submitError}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
          {exam.questions.map((q: any, index: number) => {
            const qId = String(q._id ?? q.id ?? '')
            return (
              <Button
                key={index}
                variant={index === currentQuestion ? "default" : answers[qId] ? "outline" : "ghost"}
                className="h-10 w-10"
                onClick={() => setCurrentQuestion(index)}
              >
                {index + 1}
              </Button>
            )
          })}
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
              <li>You can navigate between questions using the buttons above.</li>
              <li>Once submitted, your answers will be evaluated by our AI system.</li>
              <li>You cannot return to the exam after submission.</li>
              {exam.negativeMarking && (
                <li className="text-amber-600 dark:text-amber-400">
                  ⚠️ Negative marking is enabled for this exam.
                </li>
              )}
              <li>The exam will auto-submit when time runs out.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
