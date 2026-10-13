"use client"

import { Button } from "@/frontend/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/frontend/components/ui/card"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
import { Input } from "@/frontend/components/ui/input"
import { Trash2, Plus } from "lucide-react"
import {
  appendChoice,
  normalizeExamQuestionType,
  removeChoice,
  replaceChoice,
  withQuestionType,
  type ExamQuestionDraft,
  type ExamQuestionType,
} from "@/frontend/lib/examCreation"

export type Question = ExamQuestionDraft

interface QuestionEditorProps {
  questions: Question[]
  processingRequest: boolean
  onAdd: (type: string) => void
  onRemove: (id: number) => void
  onUpdate: (id: number, data: Partial<Question>) => void
}

const TYPE_LABELS: Record<ExamQuestionType, string> = {
  TEXT: "Theory",
  MCQ: "Multiple choice",
  TRUE_FALSE: "True / False",
}

export function QuestionEditor({ questions, processingRequest, onAdd, onRemove, onUpdate }: QuestionEditorProps) {
  const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 0), 0)

  const changeType = (question: Question, value: string) => {
    const nextType = normalizeExamQuestionType(value)
    if (!nextType) return
    onUpdate(question.id, withQuestionType(question, nextType))
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Questions</CardTitle>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Add theory, multiple choice, or true/false questions • Total Marks: {totalMarks}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => onAdd("theory")} size="sm" className="gap-1" disabled={processingRequest}>
            <Plus className="h-4 w-4" /> Add Theory Question
          </Button>
          <Button type="button" onClick={() => onAdd("mcq")} size="sm" variant="outline" className="gap-1" disabled={processingRequest}>
            <Plus className="h-4 w-4" /> Add Multiple Choice
          </Button>
          <Button type="button" onClick={() => onAdd("true_false")} size="sm" variant="outline" className="gap-1" disabled={processingRequest}>
            <Plus className="h-4 w-4" /> Add True/False
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {questions.map((question, index) => (
          <Card key={question.id} className="border border-gray-200 dark:border-gray-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Question {index + 1}
                <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                  {TYPE_LABELS[question.questionType]}
                </span>
              </CardTitle>
              <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(question.id)} disabled={processingRequest}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor={`question-type-${question.id}`}>Question type</Label>
                <select
                  id={`question-type-${question.id}`}
                  value={question.questionType}
                  disabled={processingRequest}
                  onChange={(event) => changeType(question, event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="TEXT">Theory</option>
                  <option value="MCQ">Multiple choice</option>
                  <option value="TRUE_FALSE">True / False</option>
                </select>
              </div>

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
                  readOnly={processingRequest}
                  onChange={(e) => onUpdate(question.id, { marks: Number.parseInt(e.target.value) || 0 })}
                />
              </div>

              {question.questionType === "TEXT" && (
                <div className="grid gap-2">
                  <Label htmlFor={`answer-${question.id}`}>Model answer (optional)</Label>
                  <Textarea
                    id={`answer-${question.id}`}
                    placeholder="Enter a sample answer or rubric"
                    value={question.answer}
                    readOnly={processingRequest}
                    onChange={(e) => onUpdate(question.id, { answer: e.target.value })}
                  />
                </div>
              )}

              {question.questionType === "MCQ" && (
                <div className="grid gap-2">
                  <Label>Choices</Label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Mark the correct choice.</p>
                  {(question.options ?? []).map((option, optionIndex) => (
                    <div key={optionIndex} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`correct-${question.id}`}
                        className="h-4 w-4"
                        checked={question.correctOption === optionIndex}
                        disabled={processingRequest}
                        aria-label={`Mark choice ${optionIndex + 1} as correct`}
                        onChange={() => onUpdate(question.id, { correctOption: optionIndex })}
                      />
                      <Input
                        id={`choice-${question.id}-${optionIndex}`}
                        value={option}
                        readOnly={processingRequest}
                        placeholder={`Choice ${optionIndex + 1}`}
                        aria-label={`Choice ${optionIndex + 1}`}
                        onChange={(e) =>
                          onUpdate(question.id, {
                            options: replaceChoice(question.options ?? [], optionIndex, e.target.value),
                          })
                        }
                      />
                      {(question.options?.length ?? 0) > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={processingRequest}
                          aria-label={`Remove choice ${optionIndex + 1}`}
                          onClick={() => onUpdate(question.id, removeChoice(question.options ?? [], optionIndex, question.correctOption))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit gap-1"
                    disabled={processingRequest}
                    onClick={() => onUpdate(question.id, { options: appendChoice(question.options ?? []) })}
                  >
                    <Plus className="h-4 w-4" /> Add choice
                  </Button>
                </div>
              )}

              {question.questionType === "TRUE_FALSE" && (
                <div className="grid gap-2">
                  <Label>Correct answer</Label>
                  {["True", "False"].map((label, optionIndex) => (
                    <label key={label} className="flex items-center gap-2 text-sm" htmlFor={`tf-${question.id}-${optionIndex}`}>
                      <input
                        id={`tf-${question.id}-${optionIndex}`}
                        type="radio"
                        name={`true-false-${question.id}`}
                        className="h-4 w-4"
                        checked={question.correctOption === optionIndex}
                        disabled={processingRequest}
                        onChange={() => onUpdate(question.id, { correctOption: optionIndex, options: ["True", "False"] })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {questions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">No questions added yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Use the buttons above to add a theory, multiple choice, or true/false question
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
