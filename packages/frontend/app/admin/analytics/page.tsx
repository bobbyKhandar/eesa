import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"

/**
 * The previous page rendered a year of invented engagement numbers.
 * There is no aggregate endpoint behind those charts, so the page states that
 * instead of presenting sample data as live analytics.
 */
export default function AdminAnalytics() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">Exam and user totals are not aggregated yet</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>No analytics source</CardTitle>
          <CardDescription>
            Per-exam results live on each submission. This screen will show charts when an aggregate endpoint exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nothing here is estimated or filled with sample students.</p>
        </CardContent>
      </Card>
    </div>
  )
}
