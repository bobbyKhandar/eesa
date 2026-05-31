import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/frontend/components/ui/card"
import { FileText, Upload } from "lucide-react"

interface SyllabusTypeSelectorProps {
  examType: "personal" | "teacher"
  onSelect: (type: "pre-uploaded" | "personal") => void
}

export function SyllabusTypeSelector({ examType, onSelect }: SyllabusTypeSelectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card className="cursor-pointer border-2 hover:border-primary hover:bg-primary/5" onClick={() => onSelect("pre-uploaded")}>
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

      <Card className="cursor-pointer border-2 hover:border-primary hover:bg-primary/5" onClick={() => onSelect("personal")}>
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
  )
}
