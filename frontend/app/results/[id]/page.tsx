import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ArrowLeft, CheckCircle, XCircle, AlertCircle } from "lucide-react"

export default function ResultsPage({ params }: { params: { id: string } }) {
  // Mock result data
  const result = {
    id: params.id,
    examTitle: "Introduction to AI",
    studentName: "Alex Johnson",
    score: 78,
    totalMarks: 100,
    passingScore: 60,
    submittedAt: "June 12, 2025, 2:45 PM",
    evaluatedAt: "June 12, 2025, 2:47 PM",
    status: "Passed",
    questions: [
      {
        id: 1,
        type: "essay",
        text: "Explain the difference between supervised and unsupervised learning in machine learning.",
        answer:
          "Supervised learning involves training models on labeled data where the desired output is known, while unsupervised learning involves finding patterns in unlabeled data without predefined outputs. In supervised learning, the algorithm learns to map inputs to outputs based on example input-output pairs, while in unsupervised learning, the algorithm identifies inherent structures in the data.",
        feedback:
          "Good explanation of the core differences. You correctly identified that supervised learning uses labeled data while unsupervised learning works with unlabeled data. Your answer could be improved by providing specific examples of algorithms for each type.",
        score: 8,
        maxScore: 10,
      },
      {
        id: 2,
        type: "mcq",
        text: "Which of the following is NOT a type of machine learning?",
        options: ["Supervised Learning", "Unsupervised Learning", "Reinforcement Learning", "Deterministic Learning"],
        selectedOption: 3,
        correctOption: 3,
        score: 5,
        maxScore: 5,
      },
      {
        id: 3,
        type: "essay",
        text: "Describe how neural networks mimic the human brain and provide an example of their application.",
        answer:
          "Neural networks mimic the human brain through interconnected nodes (neurons) that process and transmit information. They use weighted connections that adjust during training, similar to how synapses in the brain strengthen with learning. An example application is image recognition, where convolutional neural networks can identify objects in images by detecting patterns and features at different levels of abstraction.",
        feedback:
          "Excellent explanation of the parallel between neural networks and the human brain. Your example of image recognition using CNNs is appropriate and well-explained. To improve, you could mention the concept of activation functions and how they relate to the firing of neurons in the brain.",
        score: 13,
        maxScore: 15,
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
        selectedOption: 1,
        correctOption: 1,
        score: 5,
        maxScore: 5,
      },
      {
        id: 5,
        type: "essay",
        text: "Discuss the ethical implications of using AI in automated decision-making systems.",
        answer:
          "The use of AI in automated decision-making raises several ethical concerns. First, there's the issue of bias and fairness, as AI systems can perpetuate or amplify existing biases in training data. Second, there's a lack of transparency in how AI makes decisions, often functioning as a 'black box.' Third, questions of accountability arise when determining who is responsible for AI-made decisions. Finally, there are concerns about privacy and consent regarding the data used to train these systems.",
        feedback:
          "Very comprehensive discussion of the ethical implications. You've covered the major concerns including bias, transparency, accountability, and privacy. Your answer demonstrates a good understanding of the complex ethical landscape surrounding AI decision-making. To enhance your answer, you could have included specific examples of controversial AI decision-making systems.",
        score: 17,
        maxScore: 20,
      },
    ],
  }

  const totalScore = result.questions.reduce((sum, q) => sum + q.score, 0)
  const totalMaxScore = result.questions.reduce((sum, q) => sum + q.maxScore, 0)
  const scorePercentage = (totalScore / totalMaxScore) * 100

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Exam Results</h1>
            <p className="text-gray-500 dark:text-gray-400">{result.examTitle}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{result.studentName}</CardTitle>
                <CardDescription>
                  Submitted: {result.submittedAt} • Evaluated: {result.evaluatedAt}
                </CardDescription>
              </div>
              <Badge variant={result.status === "Passed" ? "default" : "destructive"}>{result.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Score</p>
                <p className="text-3xl font-bold">
                  {totalScore}/{totalMaxScore} ({Math.round(scorePercentage)}%)
                </p>
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">Passing Score: {result.passingScore}%</div>
            </div>

            <Progress value={scorePercentage} className="h-2" />

            <div className="pt-4">
              <h3 className="text-lg font-medium mb-4">AI Evaluation Feedback</h3>

              {result.questions.map((question, index) => (
                <Card key={question.id} className="mb-4 border border-gray-200 dark:border-gray-800">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Question {index + 1}</CardTitle>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {question.score}/{question.maxScore}
                        </span>
                        {question.score === question.maxScore ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : question.score === 0 ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                        )}
                      </div>
                    </div>
                    <CardDescription className="mt-1">{question.text}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-sm font-medium mb-1">Your Answer:</p>
                      {question.type === "essay" ? (
                        <p className="text-sm bg-gray-100 dark:bg-gray-800 p-3 rounded-md">{question.answer}</p>
                      ) : (
                        <p className="text-sm bg-gray-100 dark:bg-gray-800 p-3 rounded-md">
                          {question.options[question.selectedOption]}
                          {question.selectedOption === question.correctOption ? (
                            <span className="ml-2 text-green-500">(Correct)</span>
                          ) : (
                            <span className="ml-2 text-red-500">
                              (Incorrect - Correct answer: {question.options[question.correctOption]})
                            </span>
                          )}
                        </p>
                      )}
                    </div>

                    {question.type === "essay" && (
                      <div>
                        <p className="text-sm font-medium mb-1">AI Feedback:</p>
                        <p className="text-sm bg-blue-50 dark:bg-blue-950 p-3 rounded-md border-l-4 border-blue-500">
                          {question.feedback}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-center gap-4">
          <Button variant="outline">Download Results</Button>
          <Button>Return to Dashboard</Button>
        </div>
      </div>
    </div>
  )
}
