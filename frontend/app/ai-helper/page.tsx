"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import {
  Brain,
  Send,
  User,
  Bot,
  TrendingUp,
  TrendingDown,
  Calendar,
  Award,
  Target,
  MessageSquare,
  BarChart3,
  CheckCircle,
  XCircle,
  BookOpen,
  Clock,
} from "lucide-react"

interface Message {
  id: number
  type: "user" | "ai"
  content: string
  timestamp: Date
}

interface ExamResult {
  id: number
  examName: string
  subject: string
  score: number
  totalMarks: number
  percentage: number
  date: string
  status: "passed" | "failed"
  plusPoints: string[]
  negativePoints: string[]
  suggestions: string[]
}

export default function AIHelperPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      type: "ai",
      content:
        "Hello! I'm your AI Study Assistant. I can help you with your studies, analyze your exam performance, and provide personalized feedback. How can I assist you today?",
      timestamp: new Date(),
    },
  ])
  const [inputMessage, setInputMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Mock exam results data
  const examResults: ExamResult[] = [
    {
      id: 1,
      examName: "Data Structures Final",
      subject: "Computer Science",
      score: 85,
      totalMarks: 100,
      percentage: 85,
      date: "2024-01-15",
      status: "passed",
      plusPoints: [
        "Excellent understanding of tree data structures",
        "Strong implementation of sorting algorithms",
        "Good time complexity analysis",
        "Clear and well-commented code",
      ],
      negativePoints: [
        "Struggled with graph algorithms",
        "Incomplete solution for dynamic programming",
        "Could improve space complexity optimization",
      ],
      suggestions: [
        "Practice more graph traversal problems",
        "Study dynamic programming patterns",
        "Focus on space-time trade-offs",
      ],
    },
    {
      id: 2,
      examName: "Database Systems Midterm",
      subject: "Computer Science",
      score: 72,
      totalMarks: 100,
      percentage: 72,
      date: "2024-01-10",
      status: "passed",
      plusPoints: ["Good grasp of SQL queries", "Understanding of normalization concepts", "Correct ER diagram design"],
      negativePoints: [
        "Weak in transaction management",
        "Indexing concepts need improvement",
        "Query optimization unclear",
      ],
      suggestions: ["Review ACID properties thoroughly", "Practice complex SQL joins", "Study indexing strategies"],
    },
    {
      id: 3,
      examName: "Operating Systems Quiz",
      subject: "Computer Science",
      score: 45,
      totalMarks: 60,
      percentage: 75,
      date: "2024-01-05",
      status: "passed",
      plusPoints: ["Good understanding of process scheduling", "Clear concept of memory management"],
      negativePoints: ["Deadlock prevention strategies unclear", "File system concepts need work"],
      suggestions: ["Study deadlock detection algorithms", "Practice file system problems"],
    },
  ]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return

    const userMessage: Message = {
      id: messages.length + 1,
      type: "user",
      content: inputMessage,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputMessage("")
    setIsLoading(true)

    // Simulate AI response
    setTimeout(() => {
      let aiResponse = ""

      // Check if user is asking about exam results
      if (
        inputMessage.toLowerCase().includes("exam") ||
        inputMessage.toLowerCase().includes("result") ||
        inputMessage.toLowerCase().includes("performance")
      ) {
        aiResponse = `Based on your recent exam performance, here's what I found:

📊 **Overall Performance Summary:**
- Average Score: ${Math.round(examResults.reduce((acc, exam) => acc + exam.percentage, 0) / examResults.length)}%
- Total Exams: ${examResults.length}
- Pass Rate: 100%

🎯 **Your Strengths:**
• Strong in data structures and algorithms
• Good SQL and database design skills
• Excellent code documentation
• Clear understanding of core concepts

⚠️ **Areas for Improvement:**
• Graph algorithms need more practice
• Transaction management concepts
• Dynamic programming patterns
• Query optimization techniques

💡 **Personalized Recommendations:**
1. Spend 2-3 hours weekly on graph problems
2. Review database transaction properties
3. Practice dynamic programming on LeetCode
4. Study query execution plans

Would you like me to create a detailed study plan for any specific subject?`
      } else if (inputMessage.toLowerCase().includes("study plan") || inputMessage.toLowerCase().includes("schedule")) {
        aiResponse = `I'll create a personalized study plan based on your exam performance:

📅 **Weekly Study Schedule:**

**Monday & Wednesday (2 hours):**
- Graph Algorithms Practice
- Focus on DFS, BFS, and shortest path algorithms
- Solve 3-4 problems on LeetCode/HackerRank

**Tuesday & Thursday (1.5 hours):**
- Database Concepts Review
- ACID properties, transaction isolation levels
- Practice complex SQL queries

**Friday (2 hours):**
- Dynamic Programming
- Study common patterns (knapsack, LIS, etc.)
- Implement solutions from scratch

**Weekend (3 hours):**
- Review and consolidate
- Mock tests and practice exams
- Weak area reinforcement

This plan addresses your specific weak areas while building on your strengths!`
      } else if (inputMessage.toLowerCase().includes("help") || inputMessage.toLowerCase().includes("explain")) {
        aiResponse = `I'm here to help! Here's what I can do for you:

🤖 **AI Study Assistant Features:**
• Analyze your exam performance and provide detailed feedback
• Create personalized study plans based on your strengths/weaknesses
• Explain complex concepts in simple terms
• Provide practice problems and solutions
• Track your progress over time
• Give motivational support and study tips

📚 **Available Commands:**
- "Show my exam results" - View detailed performance analysis
- "Create study plan" - Get personalized study schedule
- "Explain [topic]" - Get detailed explanations
- "Practice problems" - Get relevant practice questions
- "Study tips" - Get effective study strategies

Just ask me anything about your studies, and I'll provide personalized assistance!`
      } else {
        aiResponse = `I understand you're asking about "${inputMessage}". Let me help you with that!

Based on your learning profile and recent performance, here's my response:

This is a great question! I can see from your exam history that you have a strong foundation in core concepts. Let me break this down for you in a way that builds on your existing knowledge.

Would you like me to:
1. Provide a detailed explanation with examples?
2. Show you practice problems related to this topic?
3. Create a mini study plan for mastering this concept?
4. Connect this to your recent exam performance?

Feel free to ask for any specific aspect you'd like me to focus on!`
      }

      const aiMessage: Message = {
        id: messages.length + 2,
        type: "ai",
        content: aiResponse,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, aiMessage])
      setIsLoading(false)
    }, 1500)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">AI Study Assistant</h1>
          <p className="text-gray-500 dark:text-gray-400">Your personalized learning companion with exam insights</p>
        </div>
        <Badge variant="secondary" className="bg-green-100 text-green-800">
          <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
          AI Online
        </Badge>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Conversations</CardTitle>
            <MessageSquare className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">127</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">+12 this week</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Study Hours</CardTitle>
            <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">45.5</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">This month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Topics Covered</CardTitle>
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">23</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">+5 this week</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Improvement Score</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+15%</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Since last month</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-20rem)]">
        {/* Chat Interface */}
        <div className="lg:col-span-2">
          <Card className="h-full flex flex-col">
            <CardHeader className="border-b">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Brain className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    AI Study Assistant
                    <Badge variant="secondary" className="bg-green-100 text-green-800">
                      Online
                    </Badge>
                  </CardTitle>
                  <CardDescription>Personalized learning and exam analysis</CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col p-0">
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex gap-3 ${message.type === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {message.type === "ai" && (
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary text-primary-foreground">
                            <Bot className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div
                        className={`max-w-[80%] rounded-lg p-3 ${
                          message.type === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-gray-100 dark:bg-gray-800"
                        }`}
                      >
                        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                        <div className="text-xs opacity-70 mt-1">{message.timestamp.toLocaleTimeString()}</div>
                      </div>
                      {message.type === "user" && (
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>
                            <User className="h-4 w-4" />
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex gap-3 justify-start">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary text-primary-foreground">
                          <Bot className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                        <div className="flex space-x-1">
                          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                          <div
                            className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                            style={{ animationDelay: "0.1s" }}
                          ></div>
                          <div
                            className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                            style={{ animationDelay: "0.2s" }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div ref={messagesEndRef} />
              </ScrollArea>

              <div className="border-t p-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Ask me anything about your studies..."
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isLoading}
                  />
                  <Button onClick={handleSendMessage} disabled={isLoading || !inputMessage.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button variant="outline" size="sm" onClick={() => setInputMessage("Show my exam results")}>
                    <BarChart3 className="h-3 w-3 mr-1" />
                    My Results
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setInputMessage("Create a study plan for me")}>
                    <Calendar className="h-3 w-3 mr-1" />
                    Study Plan
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setInputMessage("Give me study tips")}>
                    <Target className="h-3 w-3 mr-1" />
                    Study Tips
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Exam Results Sidebar - Fixed Position */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Award className="h-5 w-5" />
                Recent Exam Results
              </CardTitle>
              <CardDescription>Your performance analysis and feedback</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[calc(100vh-24rem)]">
                <div className="p-4 space-y-4">
                  {examResults.map((result) => (
                    <Card key={result.id} className="border">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-sm">{result.examName}</CardTitle>
                            <CardDescription className="text-xs">{result.subject}</CardDescription>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold">{result.percentage}%</div>
                            <div className="text-xs text-gray-500">
                              {result.score}/{result.totalMarks}
                            </div>
                          </div>
                        </div>
                        <Progress value={result.percentage} className="h-2" />
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Calendar className="h-3 w-3" />
                          {new Date(result.date).toLocaleDateString()}
                          {result.status === "passed" ? (
                            <CheckCircle className="h-3 w-3 text-green-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500" />
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <TrendingUp className="h-3 w-3 text-green-500" />
                            <span className="text-xs font-medium text-green-700">Plus Points</span>
                          </div>
                          <ul className="text-xs space-y-1">
                            {result.plusPoints.slice(0, 2).map((point, index) => (
                              <li key={index} className="text-green-600">
                                • {point}
                              </li>
                            ))}
                            {result.plusPoints.length > 2 && (
                              <li className="text-gray-500">+{result.plusPoints.length - 2} more...</li>
                            )}
                          </ul>
                        </div>

                        <Separator />

                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            <TrendingDown className="h-3 w-3 text-red-500" />
                            <span className="text-xs font-medium text-red-700">Areas to Improve</span>
                          </div>
                          <ul className="text-xs space-y-1">
                            {result.negativePoints.slice(0, 2).map((point, index) => (
                              <li key={index} className="text-red-600">
                                • {point}
                              </li>
                            ))}
                            {result.negativePoints.length > 2 && (
                              <li className="text-gray-500">+{result.negativePoints.length - 2} more...</li>
                            )}
                          </ul>
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full bg-transparent"
                          onClick={() => setInputMessage(`Tell me more about my ${result.examName} performance`)}
                        >
                          <MessageSquare className="h-3 w-3 mr-1" />
                          Discuss This Result
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
