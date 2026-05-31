import { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Textarea } from "@/frontend/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/ui/table"
import { Play } from "lucide-react"

export function SqlQueryEditor() {
  const [sqlQuery, setSqlQuery] = useState("")
  const [queryResult, setQueryResult] = useState<any[]>([])
  const [isExecuting, setIsExecuting] = useState(false)

  const executeQuery = async () => {
    if (!sqlQuery.trim()) return
    setIsExecuting(true)
    setTimeout(() => {
      setQueryResult([
        { id: 1, name: "John Doe", email: "john@example.com", role: "student" },
        { id: 2, name: "Jane Smith", email: "jane@example.com", role: "faculty" },
      ])
      setIsExecuting(false)
    }, 1000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SQL Query Editor</CardTitle>
        <CardDescription>Execute SQL queries against the database</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            placeholder="Enter your SQL query here..."
            value={sqlQuery}
            onChange={(e) => setSqlQuery(e.target.value)}
            rows={6}
            className="font-mono"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={executeQuery} disabled={isExecuting || !sqlQuery.trim()}>
            <Play className="h-4 w-4 mr-2" />
            {isExecuting ? "Executing..." : "Execute Query"}
          </Button>
          <Button variant="outline" onClick={() => setSqlQuery("")}>
            Clear
          </Button>
        </div>
        {queryResult.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-lg font-medium">Query Results</h3>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.keys(queryResult[0]).map((key) => (
                      <TableHead key={key}>{key}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queryResult.map((row, index) => (
                    <TableRow key={index}>
                      {Object.values(row).map((value, i) => (
                        <TableCell key={i}>{String(value)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
