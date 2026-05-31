import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/frontend/components/ui/card"
import { Label } from "@/frontend/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"

interface SubjectFilterProps {
  branches: string[]
  semesters: string[]
  selectedBranch: string
  selectedSemester: string
  selectedSubject: string
  subjectsForSelection: string[]
  onBranchChange: (v: string) => void
  onSemesterChange: (v: string) => void
  onSubjectChange: (v: string) => void
}

export function SubjectFilter({
  branches, semesters, selectedBranch, selectedSemester, selectedSubject,
  subjectsForSelection, onBranchChange, onSemesterChange, onSubjectChange,
}: SubjectFilterProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Select Subject</CardTitle>
        <CardDescription>Choose the branch, semester, and subject to view resources</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="branch">Branch</Label>
            <Select value={selectedBranch} onValueChange={onBranchChange}>
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
            <Select value={selectedSemester} onValueChange={onSemesterChange} disabled={!selectedBranch}>
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
            <Select value={selectedSubject} onValueChange={onSubjectChange} disabled={!selectedBranch || !selectedSemester}>
              <SelectTrigger id="subject">
                <SelectValue placeholder="Select subject" />
              </SelectTrigger>
              <SelectContent>
                {subjectsForSelection.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
                {subjectsForSelection.length === 0 && selectedBranch && selectedSemester && (
                  <SelectItem value="none" disabled>No subjects available</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
