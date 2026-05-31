"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
import { Textarea } from "@/frontend/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/frontend/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/frontend/components/ui/alert-dialog"
import {
  Database,
  Play,
  Download,
  Upload,
  RefreshCw,
  Activity,
  HardDrive,
  FileText,
  AlertCircle,
  CheckCircle,
  Clock,
  Trash2,
} from "lucide-react"

export default function AdminDatabase() {
  const [sqlQuery, setSqlQuery] = useState("")
  const [queryResult, setQueryResult] = useState<any[]>([])
  const [isExecuting, setIsExecuting] = useState(false)
  const [showTruncateDialog, setShowTruncateDialog] = useState(false)
  const [showSecondConfirm, setShowSecondConfirm] = useState(false)
  const [isTruncating, setIsTruncating] = useState(false)
  const [truncateResult, setTruncateResult] = useState<{ success: boolean; message: string } | null>(null)

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

  const executeQuery = async () => {
    if (!sqlQuery.trim()) return

    setIsExecuting(true)
    // Simulate query execution
    setTimeout(() => {
      // Mock result for demonstration
      setQueryResult([
        { id: 1, name: "John Doe", email: "john@example.com", role: "student" },
        { id: 2, name: "Jane Smith", email: "jane@example.com", role: "faculty" },
      ])
      setIsExecuting(false)
    }, 1000)
  }

  const handleTruncateDatabase = async () => {
    setIsTruncating(true)
    setTruncateResult(null)
    
    try {
      const response = await fetch('/api/admin/database/truncate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      
      const data = await response.json()
      
      console.log('Truncate response:', data)
      
      if (response.ok) {
        const totalDeleted = data.totalDeleted || 0
        setTruncateResult({ 
          success: true, 
          message: `${data.message || 'Database truncated successfully'} (${totalDeleted} records)` 
        })
      } else {
        setTruncateResult({ success: false, message: data.error || 'Failed to truncate database' })
      }
    } catch (error) {
      setTruncateResult({ success: false, message: 'Network error: ' + (error instanceof Error ? error.message : 'Unknown error') })
    } finally {
      setIsTruncating(false)
      setShowSecondConfirm(false)
      setShowTruncateDialog(false)
    }
  }

  const handleFirstConfirm = () => {
    setShowTruncateDialog(false)
    setShowSecondConfirm(true)
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      completed: "default",
      failed: "destructive",
      running: "secondary",
    } as const

    const icons = {
      completed: <CheckCircle className="h-3 w-3 mr-1" />,
      failed: <AlertCircle className="h-3 w-3 mr-1" />,
      running: <Clock className="h-3 w-3 mr-1" />,
    }

    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"} className="flex items-center">
        {icons[status as keyof typeof icons]}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const getPerformanceStatus = (status: string) => {
    const colors = {
      good: "text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-400",
      warning: "text-yellow-600 bg-yellow-50 dark:bg-yellow-950 dark:text-yellow-400",
      critical: "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400",
    }

    return (
      <Badge className={colors[status as keyof typeof colors] || colors.good}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

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
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
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
                        <TableCell>{getStatusBadge(backup.status)}</TableCell>
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
                    <div>{getPerformanceStatus(metric.status)}</div>
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

      {/* First Confirmation Dialog */}
      <AlertDialog open={showTruncateDialog} onOpenChange={setShowTruncateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Are you absolutely sure?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This action will permanently delete ALL data from the database, including:</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>All users and accounts</li>
                <li>All exams and submissions</li>
                <li>All resources and subjects</li>
                <li>All questions and question papers</li>
                <li>All analytics and reports</li>
                <li>All exam analyses and analysis reports</li>
                <li>All past papers and syllabi</li>
                <li>All unique questions and deduplication data</li>
                <li>All job metadata and upload sessions</li>
              </ul>
              <p className="font-semibold text-destructive mt-3">
                This action CANNOT be undone. Make sure you have a recent backup.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={handleFirstConfirm}>
              Continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Second Confirmation Dialog */}
      <AlertDialog open={showSecondConfirm} onOpenChange={setShowSecondConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Final Confirmation
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p className="text-base font-semibold">
                You are about to PERMANENTLY DELETE all data from the database.
              </p>
              <div className="rounded-lg bg-destructive/20 p-3 border border-destructive">
                <p className="text-sm font-mono text-destructive">
                  ⚠️ This will erase everything. No recovery possible.
                </p>
              </div>
              <p className="text-sm">
                Click "Delete Everything" to proceed with database truncation.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isTruncating}>Cancel</AlertDialogCancel>
            <Button 
              variant="destructive" 
              onClick={handleTruncateDatabase}
              disabled={isTruncating}
            >
              {isTruncating ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Truncating...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Everything
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
