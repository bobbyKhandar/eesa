import { Card, CardHeader, CardTitle, CardContent } from "@/frontend/components/ui/card"
import { Loader2, FileText, BookOpen, Star, Upload } from "lucide-react"

interface StatsCardsProps {
  loading: boolean
  pyqsLoading: boolean
  totalSubjects: number
  totalQuestions: number
  uniqueQuestions: number
  subjectCount: number
}

export function StatsCards({ loading, pyqsLoading, totalSubjects, totalQuestions, uniqueQuestions, subjectCount }: StatsCardsProps) {
  const cards = [
    { title: "Total Subjects", value: totalSubjects, icon: FileText, label: "Available subjects", loading },
    { title: "Total PYQs", value: totalQuestions, icon: BookOpen, label: "Questions available", loading: pyqsLoading },
    { title: "Unique Questions", value: uniqueQuestions, icon: Star, label: "Distinct questions", loading: pyqsLoading },
    { title: "Subjects Covered", value: subjectCount, icon: Upload, label: "Different subjects", loading: pyqsLoading },
  ]

  return (
    <div className="grid gap-6 md:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {card.loading ? <Loader2 className="h-6 w-6 animate-spin" /> : card.value}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
