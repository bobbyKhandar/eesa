"use client"

import { useState } from "react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/ui/table"
import { Download, Upload, RefreshCw, CheckCircle, AlertCircle, Clock, Trash2 } from "lucide-react"
import { DatabaseStatCard, SqlQueryEditor, useTruncateDialogs } from "@/frontend/components/features/admin"

export default function AdminDatabase() {
  const [truncateResult, setTruncateResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleTruncate = async () => {
    setIsTruncating(true)
    setTruncateResult(null)
    try {
      const response = await fetch('/api/admin/database/truncate', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await response.json()
      if (response.ok) {
        setTruncateResult({ success: true, message: `${data.message || 'Database truncated successfully'} (${data.totalDeleted || 0} records)` })
      } else {
        setTruncateResult({ success: false, message: data.error || 'Failed to truncate database' })
      }
    } catch (error) {
      setTruncateResult({ success: false, message: 'Network error: ' + (error instanceof Error ? error.message : 'Unknown error') })
    } finally {
      setIsTruncating(false)
    }
  }

  const { setShowFirst: setShowTruncateDialog, dialogs: truncateDialogs, isTruncating } = useTruncateDialogs(handleTruncate)

  // Mock database statistics
  const dbStats = [
    { title: "Total Tables", value: "24", icon: Database, color: "blue" },
    { title: "Total Records", value: "45.2K", icon: FileText, color: "green" },
    { title: "Database Size", value: "2.8 GB", icon: HardDrive, color: "purple" },
    { title: "Active Connections", value: "12", icon: Activity, color: "orange" },
  ]

  // Mock table information
  const tables = [
    { name: "users", records: 2847, size: "45.2 MB", lastUpdated: "2 hours ago" },
    { name: "exams", records: 156, size: "12.8 MB", lastUpdated: "30 minutes ago" },
    { name: "exam_submissions", records: 8934, size: "234.5 MB", lastUpdated: "5 minutes ago" },
    { name: "resources", records: 1234, size: "1.2 GB", lastUpdated: "1 hour ago" },
    { name: "subjects", records: 45, size: "2.1 MB", lastUpdated: "1 day ago" },
    { name: "user_sessions", records: 234, size: "8.9 MB", lastUpdated: "1 minute ago" },
  ]

  // Mock backup history
  const backups = [
    {
      id: 1,
      filename: "backup_2024_01_28_14_30.sql",
      size: "2.8 GB",
      created: "2024-01-28 14:30:00",
      status: "completed",
      type: "automatic",
    },
    {
      id: 2,
      filename: "backup_2024_01_27_14_30.sql",
      size: "2.7 GB",
      created: "2024-01-27 14:30:00",
      status: "completed",
      type: "automatic",
    },
    {
      id: 3,
      filename: "manual_backup_2024_01_26.sql",
      size: "2.7 GB",
      created: "2024-01-26 10:15:00",
      status: "completed",
      type: "manual",
    },
    {
      id: 4,
      filename: "backup_2024_01_26_14_30.sql",
      size: "2.6 GB",
      created: "2024-01-26 14:30:00",
      status: "failed",
      type: "automatic",
    },
  ]

  // Mock performance metrics
  const performanceMetrics = [
    { metric: "Query Response Time", value: "45ms", status: "good" },
    { metric: "Connection Pool Usage", value: "67%", status: "warning" },
    { metric: "Cache Hit Ratio", value: "94%", status: "good" },
    { metric: "Disk I/O", value: "234 ops/sec", status: "good" },
    { metric: "Memory Usage", value: "78%", status: "warning" },
    { metric: "CPU Usage", value: "23%", status: "good" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Database Management</h1>
          <p className="text-muted-foreground">Monitor database performance, execute queries, and manage backups</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Database Statistics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {dbStats.map((stat) => (
          <DatabaseStatCard key={stat.title} title={stat.title} value={stat.value} icon={stat.icon} />
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="query">Query Editor</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Database Tables</CardTitle>
              <CardDescription>Overview of all database tables and their statistics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Table Name</TableHead>
                      <TableHead>Records</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Last Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tables.map((table) => (
                      <TableRow key={table.name}>
                        <TableCell className="font-medium">{table.name}</TableCell>
                        <TableCell>{table.records.toLocaleString()}</TableCell>
                        <TableCell>{table.size}</TableCell>
                        <TableCell>{table.lastUpdated}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="query" className="space-y-4">
          <SqlQueryEditor />
        </TabsContent>

        <TabsContent value="backups" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Database Backups</CardTitle>
              <CardDescription>Manage database backups and restoration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button>
                  <Download className="h-4 w-4 mr-2" />
                  Create Backup
                </Button>
                <Button variant="outline">
                  <Upload className="h-4 w-4 mr-2" />
                  Restore Backup
                </Button>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Filename</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.map((backup) => (
                      <TableRow key={backup.id}>
                        <TableCell className="font-medium">{backup.filename}</TableCell>
                        <TableCell>{backup.size}</TableCell>
                        <TableCell>{backup.created}</TableCell>
                        <TableCell className="capitalize">{backup.type}</TableCell>
                        <TableCell>
                          <Badge variant={backup.status === 'failed' ? 'destructive' : 'default'} className="flex items-center">
                            {backup.status === 'completed' && <CheckCircle className="h-3 w-3 mr-1" />}
                            {backup.status === 'failed' && <AlertCircle className="h-3 w-3 mr-1" />}
                            {backup.status.charAt(0).toUpperCase() + backup.status.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm">
                              <Download className="h-3 w-3" />
                            </Button>
                            <Button variant="outline" size="sm">
                              <Upload className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance Metrics</CardTitle>
              <CardDescription>Real-time database performance monitoring</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {performanceMetrics.map((metric) => (
                  <div key={metric.metric} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <div className="font-medium">{metric.metric}</div>
                      <div className="text-2xl font-bold">{metric.value}</div>
                    </div>
                    <Badge className={metric.status === 'good' ? 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400' : 'bg-yellow-50 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-400'}>
                      {metric.status.charAt(0).toUpperCase() + metric.status.slice(1)}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="maintenance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Database Maintenance</CardTitle>
              <CardDescription>Perform database optimization and maintenance tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Optimization</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  <Button variant="outline">Optimize Tables</Button>
                  <Button variant="outline">Rebuild Indexes</Button>
                  <Button variant="outline">Update Statistics</Button>
                  <Button variant="outline">Analyze Tables</Button>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Cleanup</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  <Button variant="outline">Clean Temporary Data</Button>
                  <Button variant="outline">Remove Old Logs</Button>
                  <Button variant="outline">Purge Deleted Records</Button>
                  <Button variant="outline">Compress Archives</Button>
                </div>
              </div>
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-lg font-medium text-destructive">Danger Zone</h3>
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h4 className="font-semibold">Truncate Database</h4>
                      <p className="text-sm text-muted-foreground">
                        Permanently delete all data from the database. This action cannot be undone.
                      </p>
                    </div>
                    <Button 
                      variant="destructive" 
                      onClick={() => setShowTruncateDialog(true)}
                      disabled={isTruncating}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Truncate Database
                    </Button>
                  </div>
                  {truncateResult && (
                    <div className={`mt-3 p-3 rounded-md ${
                      truncateResult.success 
                        ? 'bg-green-50 dark:bg-green-950 text-green-900 dark:text-green-100 border border-green-200 dark:border-green-800' 
                        : 'bg-red-50 dark:bg-red-950 text-red-900 dark:text-red-100 border border-red-200 dark:border-red-800'
                    }`}>
                      <div className="flex items-center gap-2">
                        {truncateResult.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        <span className="text-sm font-medium">{truncateResult.message}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Monitoring</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  <Button variant="outline">Check Integrity</Button>
                  <Button variant="outline">Validate Constraints</Button>
                  <Button variant="outline">Monitor Locks</Button>
                  <Button variant="outline">View Active Queries</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {truncateDialogs}
    </div>
  )
}
