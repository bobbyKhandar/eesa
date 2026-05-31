import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/frontend/components/ui/card"
import { Label } from "@/frontend/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Button } from "@/frontend/components/ui/button"

const branches = ["Computer Science", "Electrical Engineering", "Mechanical Engineering", "Civil Engineering"]
const semesters = Array.from({ length: 8 }, (_, i) => `Semester ${i + 1}`)

const subjects: Record<string, Record<string, string[]>> = {
  "Computer Science": {
    "Semester 1": ["Introduction to Programming", "Digital Logic", "Mathematics I"],
    "Semester 2": ["Data Structures", "Computer Organization", "Mathematics II"],
  },
  "Electrical Engineering": {
    "Semester 1": ["Basic Electrical Engineering", "Physics", "Mathematics I"],
    "Semester 2": ["Circuit Theory", "Electronics", "Mathematics II"],
  },
}

interface SubjectSelectorProps {
  branch: string
  semester: string
  subject: string
  onBranchChange: (v: string) => void
  onSemesterChange: (v: string) => void
  onSubjectChange: (v: string) => void
  onContinue: () => void
}

export function SubjectSelector({ branch, semester, subject, onBranchChange, onSemesterChange, onSubjectChange, onContinue }: SubjectSelectorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose Subject from Syllabus</CardTitle>
        <CardDescription>Select the branch, semester, and subject for your exam</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="branch">Branch</Label>
            <Select value={branch} onValueChange={onBranchChange}>
              <SelectTrigger id="branch">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="semester">Semester</Label>
            <Select value={semester} onValueChange={onSemesterChange} disabled={!branch}>
              <SelectTrigger id="semester">
                <SelectValue placeholder="Select semester" />
              </SelectTrigger>
              <SelectContent>
                {semesters.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="subject">Subject</Label>
            <Select value={subject} onValueChange={onSubjectChange} disabled={!branch || !semester}>
              <SelectTrigger id="subject">
                <SelectValue placeholder="Select subject" />
              </SelectTrigger>
              <SelectContent>
                {branch && semester && subjects[branch]?.[semester]?.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button disabled={!branch || !semester || !subject} onClick={onContinue}>
          Continue
        </Button>
      </CardFooter>
    </Card>
  )
}
