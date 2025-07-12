import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowLeft, BookOpen, Clock, Users, GraduationCap, FileText, Brain } from "lucide-react"

export default function SubjectDetailPage({ params }: { params: { id: string } }) {
  // Mock subject data
  const subject = {
    id: params.id,
    name: "Data Structures & Algorithms",
    code: "CS201",
    branch: "Computer Science",
    year: "SY",
    semester: "Semester 3",
    credits: 4,
    type: "Core",
    instructor: "Prof. Michael Chen",
    description:
      "This course covers fundamental data structures and algorithmic techniques essential for computer science students. Topics include arrays, linked lists, stacks, queues, trees, graphs, sorting algorithms, and complexity analysis.",
    enrolledStudents: 95,
    duration: "16 weeks",
    prerequisites: ["Programming Fundamentals", "Mathematics I"],
    learningOutcomes: [
      "Understand and implement basic data structures",
      "Analyze time and space complexity of algorithms",
      "Design efficient algorithms for problem solving",
      "Apply appropriate data structures for specific problems",
    ],
    syllabus: [
      {
        week: "Week 1-2",
        topic: "Introduction to Data Structures",
        subtopics: ["Arrays", "Strings", "Basic Operations"],
      },
      {
        week: "Week 3-4",
        topic: "Linked Lists",
        subtopics: ["Singly Linked Lists", "Doubly Linked Lists", "Circular Lists"],
      },
      {
        week: "Week 5-6",
        topic: "Stacks and Queues",
        subtopics: ["Stack Operations", "Queue Operations", "Applications"],
      },
      {
        week: "Week 7-8",
        topic: "Trees",
        subtopics: ["Binary Trees", "Binary Search Trees", "Tree Traversals"],
      },
      {
        week: "Week 9-10",
        topic: "Graphs",
        subtopics: ["Graph Representation", "DFS", "BFS"],
      },
      {
        week: "Week 11-12",
        topic: "Sorting Algorithms",
        subtopics: ["Bubble Sort", "Quick Sort", "Merge Sort"],
      },
      {
        week: "Week 13-14",
        topic: "Searching Algorithms",
        subtopics: ["Linear Search", "Binary Search", "Hashing"],
      },
      {
        week: "Week 15-16",
        topic: "Advanced Topics",
        subtopics: ["Dynamic Programming", "Greedy Algorithms", "Complexity Analysis"],
      },
    ],
    assessments: [
      { type: "Assignments", weightage: "20%" },
      { type: "Midterm Exam", weightage: "30%" },
      { type: "Final Exam", weightage: "40%" },
      { type: "Lab Work", weightage: "10%" },
    ],
    textbooks: [
      {
        title: "Introduction to Algorithms",
        authors: "Cormen, Leiserson, Rivest, Stein",
        edition: "3rd Edition",
        type: "Primary",
      },
      {
        title: "Data Structures and Algorithms in Java",
        authors: "Robert Lafore",
        edition: "2nd Edition",
        type: "Reference",
      },
    ],
  }

  const getYearBadgeColor = (year: string) => {
    switch (year) {
      case "FY":
        return "bg-blue-500"
      case "SY":
        return "bg-green-500"
      case "TY":
        return "bg-orange-500"
      case "LY":
        return "bg-purple-500"
      default:
        return "bg-gray-500"
    }
  }

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case "Core":
        return "bg-red-500"
      case "Elective":
        return "bg-blue-500"
      default:
        return "bg-gray-500"
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/subjects">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">{subject.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={getYearBadgeColor(subject.year)}>{subject.year}</Badge>
              <Badge className={getTypeBadgeColor(subject.type)} variant="outline">
                {subject.type}
              </Badge>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {subject.code} • {subject.branch} • {subject.semester}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Course Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 dark:text-gray-400">{subject.description}</p>
              </CardContent>
            </Card>

            <Tabs defaultValue="syllabus" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="syllabus">Syllabus</TabsTrigger>
                <TabsTrigger value="outcomes">Learning Outcomes</TabsTrigger>
                <TabsTrigger value="assessments">Assessments</TabsTrigger>
                <TabsTrigger value="textbooks">Textbooks</TabsTrigger>
              </TabsList>

              <TabsContent value="syllabus" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Course Syllabus</CardTitle>
                    <CardDescription>Weekly breakdown of topics covered in this course</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {subject.syllabus.map((item, index) => (
                        <div key={index} className="border rounded-md p-4">
                          <div className="font-medium text-lg mb-2">
                            {item.week}: {item.topic}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {item.subtopics.map((subtopic, subIndex) => (
                              <Badge key={subIndex} variant="outline">
                                {subtopic}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="outcomes" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Learning Outcomes</CardTitle>
                    <CardDescription>What you will learn by the end of this course</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {subject.learningOutcomes.map((outcome, index) => (
                        <div key={index} className="flex items-start gap-3">
                          <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium mt-0.5">
                            {index + 1}
                          </div>
                          <p className="text-gray-600 dark:text-gray-400">{outcome}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="assessments" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Assessment Structure</CardTitle>
                    <CardDescription>How your performance will be evaluated</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {subject.assessments.map((assessment, index) => (
                        <div key={index} className="flex items-center justify-between p-3 border rounded-md">
                          <span className="font-medium">{assessment.type}</span>
                          <Badge variant="outline">{assessment.weightage}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="textbooks" className="mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Recommended Textbooks</CardTitle>
                    <CardDescription>Essential and reference books for this course</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {subject.textbooks.map((book, index) => (
                        <div key={index} className="border rounded-md p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-medium text-lg">{book.title}</div>
                              <div className="text-gray-600 dark:text-gray-400">by {book.authors}</div>
                              <div className="text-sm text-gray-500 dark:text-gray-500">{book.edition}</div>
                            </div>
                            <Badge variant={book.type === "Primary" ? "default" : "outline"}>{book.type}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Course Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm">Instructor: {subject.instructor}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm">Duration: {subject.duration}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm">Credits: {subject.credits}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  <span className="text-sm">Enrolled: {subject.enrolledStudents} students</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Prerequisites</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {subject.prerequisites.map((prereq, index) => (
                    <Badge key={index} variant="outline" className="block w-fit">
                      {prereq}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link href={`/resources?subject=${subject.code}`} className="block">
                  <Button variant="outline" className="w-full justify-start gap-2 bg-transparent">
                    <FileText className="h-4 w-4" /> View Resources
                  </Button>
                </Link>
                <Link href={`/exams?subject=${subject.code}`} className="block">
                  <Button variant="outline" className="w-full justify-start gap-2 bg-transparent">
                    <BookOpen className="h-4 w-4" /> Practice Exams
                  </Button>
                </Link>
                <Link href={`/resources?subject=${subject.code}&tab=ai-helper`} className="block">
                  <Button className="w-full justify-start gap-2">
                    <Brain className="h-4 w-4" /> AI Course Helper
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
