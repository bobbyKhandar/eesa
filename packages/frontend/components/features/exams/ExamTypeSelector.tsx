import { Card, CardHeader, CardTitle, CardContent } from "@/frontend/components/ui/card"
import { BookOpen, Users } from "lucide-react"

interface ExamTypeSelectorProps {
  onSelect: (type: "personal" | "teacher") => void
}

export function ExamTypeSelector({ onSelect }: ExamTypeSelectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="cursor-pointer border-2 hover:border-primary hover:bg-primary/5" onClick={() => onSelect("personal")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Personal Use
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Create an exam for your personal study or practice. You&apos;ll be the only one taking this exam.
          </p>
        </CardContent>
      </Card>

      <Card className="cursor-pointer border-2 hover:border-primary hover:bg-primary/5" onClick={() => onSelect("teacher")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Teacher Assignment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Create an exam to assign to students. You&apos;ll be able to share this exam and collect responses.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
