"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Search,
  MoreHorizontal,
  Upload,
  Download,
  FileText,
  Video,
  FileImage,
  File,
  Eye,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
} from "lucide-react"

export default function AdminResources() {
  const [searchTerm, setSearchTerm] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")

  // Mock resource data
  const resources = [
    {
      id: 1,
      title: "Advanced Calculus Notes",
      type: "pdf",
      subject: "Mathematics",
      uploadedBy: "Dr. Smith",
      uploadDate: "2024-01-15",
      status: "approved",
      downloads: 245,
      size: "2.4 MB",
      branch: "Engineering",
    },
    {
      id: 2,
      title: "Physics Lab Demonstration",
      type: "video",
      subject: "Physics",
      uploadedBy: "Prof. Johnson",
      uploadDate: "2024-01-20",
      status: "pending",
      downloads: 0,
      size: "156 MB",
      branch: "Science",
    },
    {
      id: 3,
      title: "Chemistry Formulas Reference",
      type: "pdf",
      subject: "Chemistry",
      uploadedBy: "Dr. Wilson",
      uploadDate: "2024-01-18",
      status: "approved",
      downloads: 189,
      size: "1.8 MB",
      branch: "Science",
    },
    {
      id: 4,
      title: "Programming Concepts Slides",
      type: "presentation",
      subject: "Computer Science",
      uploadedBy: "Prof. Davis",
      uploadDate: "2024-01-22",
      status: "approved",
      downloads: 312,
      size: "8.5 MB",
      branch: "Engineering",
    },
    {
      id: 5,
      title: "Biology Lab Manual",
      type: "pdf",
      subject: "Biology",
      uploadedBy: "Dr. Brown",
      uploadDate: "2024-01-25",
      status: "rejected",
      downloads: 0,
      size: "4.2 MB",
      branch: "Science",
    },
  ]

  const resourceStats = [
    { title: "Total Resources", value: "1,234", icon: FileText, color: "blue" },
    { title: "Pending Approval", value: "23", icon: Clock, color: "yellow" },
    { title: "Total Downloads", value: "15.6K", icon: Download, color: "green" },
    { title: "Storage Used", value: "2.8 GB", icon: TrendingUp, color: "purple" },
  ]

  const filteredResources = resources.filter((resource) => {
    const matchesSearch =
      resource.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      resource.subject.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = typeFilter === "all" || resource.type === typeFilter
    const matchesStatus = statusFilter === "all" || resource.status === statusFilter
    return matchesSearch && matchesType && matchesStatus
  })

  const getFileIcon = (type: string) => {
    switch (type) {
      case "pdf":
        return <FileText className="h-4 w-4 text-red-500" />
      case "video":
        return <Video className="h-4 w-4 text-blue-500" />
      case "presentation":
        return <FileImage className="h-4 w-4 text-orange-500" />
      default:
        return <File className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      approved: "default",
      pending: "secondary",
      rejected: "destructive",
    } as const

    const icons = {
      approved: <CheckCircle className="h-3 w-3 mr-1" />,
      pending: <Clock className="h-3 w-3 mr-1" />,
      rejected: <XCircle className="h-3 w-3 mr-1" />,
    }

    return (
      <Badge variant={variants[status as keyof typeof variants] || "secondary"} className="flex items-center">
        {icons[status as keyof typeof icons]}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resource Management</h1>
          <p className="text-muted-foreground">Manage and moderate educational resources across all subjects</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Upload Resource
          </Button>
        </div>
      </div>

      {/* Resource Statistics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {resourceStats.map((stat) => (
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

      {/* Resources Table */}
      <Card>
        <CardHeader>
          <CardTitle>Resources</CardTitle>
          <CardDescription>Review and manage all uploaded resources</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search resources..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="presentation">Presentation</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Downloads</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="w-[50px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResources.map((resource) => (
                  <TableRow key={resource.id}>
                    <TableCell>
                      <div className="flex items-center space-x-3">
                        {getFileIcon(resource.type)}
                        <div>
                          <div className="font-medium">{resource.title}</div>
                          <div className="text-sm text-muted-foreground">{resource.branch}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">{resource.type}</TableCell>
                    <TableCell>{resource.subject}</TableCell>
                    <TableCell>{resource.uploadedBy}</TableCell>
                    <TableCell>{getStatusBadge(resource.status)}</TableCell>
                    <TableCell>{resource.downloads}</TableCell>
                    <TableCell>{resource.size}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <Eye className="h-4 w-4 mr-2" />
                            Preview
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Approve
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
