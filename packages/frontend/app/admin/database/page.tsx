"use client"

import { useState, useEffect } from "react"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Badge } from "@/frontend/components/ui/badge"
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
import { Download, Upload, RefreshCw, CheckCircle, AlertCircle, Clock, Trash2, Database, FileText, HardDrive, Activity, Loader2 } from "lucide-react"
import { DatabaseStatCard, SqlQueryEditor, useTruncateDialogs } from "@/frontend/components/features/admin"

interface DbStats {
  totalCollections: number
  totalDocuments: number
  databaseSize: string
  connectionStatus: string
  host: string
  dbName: string
}

interface CollectionInfo {
  name: string
  documents: number
}

interface DbData {
  stats: DbStats
  collections: CollectionInfo[]
}

interface BackupItem {
  id: string
  timestamp: string
  size: number
  collectionCounts: Record<string, number>
  totalDocuments: number
  status: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i]
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString()
}

export default function AdminDatabase() {
  const [dbData, setDbData] = useState<DbData | null>(null)
  const [backups, setBackups] = useState<BackupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [backupCreating, setBackupCreating] = useState(false)
  const [backupResult, setBackupResult] = useState<{ success: boolean; message: string } | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null)

  const [truncateResult, setTruncateResult] = useState<{ success: boolean; message: string } | null>(null)

  const handleTruncate = async () => {
    setIsTruncating(true)
    setTruncateResult(null)
    try {
      const response = await fetch("/api/admin/database/truncate", { method: "POST", headers: { "Content-Type": "application/json" } })
      const data = await response.json()
      if (response.ok) {
        setTruncateResult({ success: true, message: `${data.message || "Database truncated successfully"} (${data.totalDeleted || 0} records)` })
      } else {
        setTruncateResult({ success: false, message: data.error || "Failed to truncate database" })
      }
    } catch (error) {
      setTruncateResult({ success: false, message: "Network error: " + (error instanceof Error ? error.message : "Unknown error") })
    } finally {
      setIsTruncating(false)
    }
  }

  const { setShowFirst: setShowTruncateDialog, dialogs: truncateDialogs, isTruncating } = useTruncateDialogs(handleTruncate)

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      const [dbRes, backupRes] = await Promise.all([
        fetch("/api/admin/database"),
        fetch("/api/admin/database/backup"),
      ])

      const dbJson = await dbRes.json()
      if (!dbRes.ok || !dbJson.success) {
        throw new Error(dbJson.error || "Failed to fetch database stats")
      }
      setDbData(dbJson.data)

      const backupJson = await backupRes.json()
      if (backupRes.ok && backupJson.success) {
        setBackups(backupJson.data)
      }
    } catch (err: any) {
      setError(err.message || "Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleCreateBackup = async () => {
    setBackupCreating(true)
    setBackupResult(null)
    try {
      const response = await fetch("/api/admin/database/backup", { method: "POST", headers: { "Content-Type": "application/json" } })
      const data = await response.json()
      if (response.ok && data.success) {
        setBackupResult({ success: true, message: `Backup created: ${data.data.id}` })
        await fetchData()
      } else {
        setBackupResult({ success: false, message: data.error || "Failed to create backup" })
      }
    } catch (err: any) {
      setBackupResult({ success: false, message: "Network error: " + err.message })
    } finally {
      setBackupCreating(false)
    }
  }

  const handleRestoreBackup = async (id: string) => {
    setRestoringId(id)
    setRestoreConfirm(null)
    try {
      const response = await fetch(`/api/admin/database/backup/${id}/restore`, { method: "POST", headers: { "Content-Type": "application/json" } })
      const data = await response.json()
      if (response.ok && data.success) {
        setTruncateResult({ success: true, message: data.data.message })
        await fetchData()
      } else {
        setTruncateResult({ success: false, message: data.error || "Failed to restore backup" })
      }
    } catch (err: any) {
      setTruncateResult({ success: false, message: "Network error: " + err.message })
    } finally {
      setRestoringId(null)
    }
  }

  const handleDeleteBackup = async (id: string) => {
    setDeletingId(id)
    try {
      const response = await fetch(`/api/admin/database/backup/${id}`, { method: "DELETE" })
      const data = await response.json()
      if (response.ok && data.success) {
        setBackups((prev) => prev.filter((b) => b.id !== id))
      }
    } catch {
    } finally {
      setDeletingId(null)
    }
  }

  const dbStatsCards = dbData
    ? [
        { title: "Total Collections", value: dbData.stats.totalCollections.toString(), icon: Database },
        { title: "Total Documents", value: dbData.stats.totalDocuments.toLocaleString(), icon: FileText },
        { title: "Database Size", value: dbData.stats.databaseSize, icon: HardDrive },
        { title: "Connection", value: dbData.stats.connectionStatus === "connected" ? "Connected" : dbData.stats.connectionStatus, icon: Activity },
      ]
    : []

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Database Management</h1>
            <p className="text-muted-foreground">Loading database information...</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Database Management</h1>
            <p className="text-muted-foreground">Failed to load database information</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-lg font-medium text-destructive">Error loading data</p>
          <p className="text-sm text-muted-foreground mt-2">{error}</p>
          <Button variant="outline" className="mt-4" onClick={fetchData}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Database Management</h1>
          <p className="text-muted-foreground">Monitor, backup, and manage your database</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {truncateResult && (
        <div className={`p-3 rounded-md ${
          truncateResult.success
            ? "bg-green-50 dark:bg-green-950 text-green-900 dark:text-green-100 border border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-950 text-red-900 dark:text-red-100 border border-red-200 dark:border-red-800"
        }`}>
          <div className="flex items-center gap-2">
            {truncateResult.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="text-sm font-medium">{truncateResult.message}</span>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {dbStatsCards.map((stat) => (
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
              <CardTitle>Collections</CardTitle>
              <CardDescription>Overview of all database collections and document counts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Collection Name</TableHead>
                      <TableHead>Documents</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(dbData?.collections ?? []).map((col) => (
                      <TableRow key={col.name}>
                        <TableCell className="font-medium">{col.name}</TableCell>
                        <TableCell>{col.documents.toLocaleString()}</TableCell>
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
              <CardDescription>Create, restore, and manage S3 database backups</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button onClick={handleCreateBackup} disabled={backupCreating}>
                  {backupCreating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
                  ) : (
                    <><Download className="h-4 w-4 mr-2" /> Create Backup</>
                  )}
                </Button>
              </div>
              {backupResult && (
                <div className={`p-3 rounded-md ${
                  backupResult.success
                    ? "bg-green-50 dark:bg-green-950 text-green-900 dark:text-green-100 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-950 text-red-900 dark:text-red-100 border border-red-200 dark:border-red-800"
                }`}>
                  <div className="flex items-center gap-2">
                    {backupResult.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                    <span className="text-sm font-medium">{backupResult.message}</span>
                  </div>
                </div>
              )}
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Backup ID</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Documents</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backups.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No backups yet. Click "Create Backup" to get started.
                        </TableCell>
                      </TableRow>
                    ) : (
                      backups.map((backup) => (
                        <TableRow key={backup.id}>
                          <TableCell className="font-medium font-mono text-xs">{backup.id}</TableCell>
                          <TableCell>{formatTimestamp(backup.timestamp)}</TableCell>
                          <TableCell>{formatBytes(backup.size)}</TableCell>
                          <TableCell>{backup.totalDocuments.toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge variant={backup.status === "failed" ? "destructive" : "default"} className="flex items-center w-fit">
                              {backup.status === "completed" && <CheckCircle className="h-3 w-3 mr-1" />}
                              {backup.status === "failed" && <AlertCircle className="h-3 w-3 mr-1" />}
                              {backup.status.charAt(0).toUpperCase() + backup.status.slice(1)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setRestoreConfirm(backup.id)}
                                disabled={restoringId === backup.id}
                                title="Restore"
                              >
                                {restoringId === backup.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Upload className="h-3 w-3" />
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteBackup(backup.id)}
                                disabled={deletingId === backup.id}
                                title="Delete"
                              >
                                {deletingId === backup.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
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
              <CardDescription>Database connection and performance monitoring</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <div className="font-medium">Connection Status</div>
                    <div className="text-2xl font-bold capitalize">{dbData?.stats.connectionStatus ?? "unknown"}</div>
                  </div>
                  <Badge className={dbData?.stats.connectionStatus === "connected" ? "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400" : "bg-yellow-50 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-400"}>
                    {dbData?.stats.connectionStatus === "connected" ? "Good" : "Warning"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <div className="font-medium">Database Host</div>
                    <div className="text-2xl font-bold">{dbData?.stats.host ?? "unknown"}</div>
                  </div>
                  <Badge className="bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400">Good</Badge>
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <div className="font-medium">Database Name</div>
                    <div className="text-2xl font-bold">{dbData?.stats.dbName ?? "unknown"}</div>
                  </div>
                  <Badge className="bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400">Good</Badge>
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <div className="font-medium">Total Documents</div>
                    <div className="text-2xl font-bold">{(dbData?.stats.totalDocuments ?? 0).toLocaleString()}</div>
                  </div>
                  <Badge className="bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400">Good</Badge>
                </div>
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

      <AlertDialog open={!!restoreConfirm} onOpenChange={(open) => { if (!open) setRestoreConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Restore Backup?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will replace ALL current data with the data from this backup.</p>
              <p className="font-semibold text-destructive mt-3">
                This action CANNOT be undone. Current data will be lost.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => restoreConfirm && handleRestoreBackup(restoreConfirm)}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
