import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"

/**
 * Platform settings (maintenance mode, session timeout, backup schedule) have
 * no stored document. The old form kept those switches in component state and
 * the Save button did not call an API.
 */
export default function AdminSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System settings</h1>
        <p className="text-muted-foreground">No platform settings document is stored yet</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Nothing to save</CardTitle>
          <CardDescription>
            Account notification preferences are stored on each user. Site-wide switches are not.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            User status is changed from User management. Database backup and restore stay on the Database screen.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
