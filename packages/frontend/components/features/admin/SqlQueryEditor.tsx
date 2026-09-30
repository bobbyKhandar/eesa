import { useState } from "react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Textarea } from "@/frontend/components/ui/textarea"
import { AlertCircle } from "lucide-react"

export function SqlQueryEditor() {
  const [sqlQuery, setSqlQuery] = useState("")

  return (
    <Card>
      <CardHeader>
        <CardTitle>SQL Query Editor</CardTitle>
        <CardDescription>Execute SQL queries against the database</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <p className="text-sm text-destructive">
            Not available. There is no query API behind this tab yet - it used to display hardcoded
            sample rows that looked like real users.
          </p>
        </div>
        <div className="space-y-2">
          <Textarea
            placeholder="Query execution is not implemented yet"
            value={sqlQuery}
            onChange={(e) => setSqlQuery(e.target.value)}
            rows={6}
            className="font-mono"
            disabled
          />
        </div>
        <div className="flex gap-2">
          <Button disabled title="Query execution is not implemented">
            Execute Query
          </Button>
          <Button variant="outline" onClick={() => setSqlQuery("")}>
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
