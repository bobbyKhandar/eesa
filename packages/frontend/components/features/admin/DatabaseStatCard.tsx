import { Card, CardHeader, CardTitle, CardContent } from "@/frontend/components/ui/card"
import type { LucideIcon } from "lucide-react"

interface DatabaseStatCardProps {
  title: string
  value: string
  icon: LucideIcon
}

export function DatabaseStatCard({ title, value, icon: Icon }: DatabaseStatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  )
}
