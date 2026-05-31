import { Button } from "@/frontend/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/frontend/components/ui/card"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
import { Input } from "@/frontend/components/ui/input"
import { Trash2, Plus } from "lucide-react"

export interface Question {
  id: number
  type: string
  text: string
  marks: number
  questionType: "TEXT" | "MCQ" | "TRUE_FALSE"
  answer?: string
  options?: string[]
  correctOption?: number
}

interface QuestionEditorProps {
  questions: Question[]
  processingRequest: boolean
  onAdd: (type: string) => void
  onRemove: (id: number) => void
  onUpdate: (id: number, data: Partial<Question>) => void
}

export function QuestionEditor({ questions, processingRequest, onAdd, onRemove, onUpdate }: QuestionEditorProps) {
  const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 0), 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Questions</CardTitle>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Add and configure exam questions • Total Marks: {totalMarks}
          </p>
        </div>
        <Button onClick={() => onAdd("theory")} size="sm" className="gap-1">
          <Plus className="h-4 w-4" /> Add Theory Question
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {questions.map((question, index) => (
          <Card key={question.id} className="border border-gray-200 dark:border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Question {index + 1}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => onRemove(question.id)}>
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
                  onChange={(e) => onUpdate(question.id, { text: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`marks-${question.id}`}>Marks</Label>
                <Input
                  id={`marks-${question.id}`}
                  type="number"
                  value={question.marks}
                  onChange={(e) => onUpdate(question.id, { marks: Number.parseInt(e.target.value) || 0 })}
                />
              </div>
            </CardContent>
          </Card>
        ))}

        {questions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">No questions added yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Use the button above to add questions</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
