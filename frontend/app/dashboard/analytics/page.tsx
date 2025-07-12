"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts"
import {
  TrendingUp,
  Users,
  BookOpen,
  Download,
  Award,
  Calendar,
  Filter,
  FileText,
  BarChart3,
  Activity,
} from "lucide-react"

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState("last-30-days")
  const [subjectFilter, setSubjectFilter] = useState("all")
  const [branchFilter, setBranchFilter] = useState("all")
  const [groupFilter, setGroupFilter] = useState("all")

  // Mock data for analytics
  const overviewStats = {
    totalStudents: 1247,
    totalExams: 156,
    totalResources: 342,
    avgScore: 78.5,
    passRate: 85.2,
    activeUsers: 892,
  }

  const performanceData = [
    { subject: "Data Structures", avgScore: 82, students: 95, passRate: 88 },
    { subject: "Operating Systems", avgScore: 76, students: 88, passRate: 82 },
    { subject: "Database Systems", avgScore: 85, students: 78, passRate: 91 },
    { subject: "Computer Networks", avgScore: 73, students: 72, passRate: 79 },
    { subject: "Machine Learning", avgScore: 79, students: 45, passRate: 84 },
    { subject: "Web Development", avgScore: 87, students: 62, passRate: 93 },
  ]

  const monthlyTrends = [
    { month: "Jan", exams: 45, avgScore: 76, resources: 28 },
    { month: "Feb", exams: 52, avgScore: 78, resources: 34 },
    { month: "Mar", exams: 48, avgScore: 81, resources: 29 },
    { month: "Apr", exams: 61, avgScore: 79, resources: 42 },
    { month: "May", exams: 58, avgScore: 82, resources: 38 },
    { month: "Jun", exams: 67, avgScore: 80, resources: 45 },
  ]

  const resourceUsage = [
    { name: "PYQ Papers", downloads: 2847, percentage: 35 },
    { name: "Faculty Notes", downloads: 2156, percentage: 26 },
    { name: "Student Notes", downloads: 1923, percentage: 24 },
    { name: "AI Helper", usage: 1234, percentage: 15 },
  ]

  const branchPerformance = [
    { branch: "Computer Science", students: 456, avgScore: 81, color: "#8884d8" },
    { branch: "Electrical Engineering", students: 342, avgScore: 78, color: "#82ca9d" },
    { branch: "Mechanical Engineering", students: 289, avgScore: 75, color: "#ffc658" },
    { branch: "Civil Engineering", students: 160, avgScore: 73, color: "#ff7300" },
  ]

  const engagementData = [
    { day: "Mon", logins: 234, examsTaken: 45, resourcesAccessed: 156 },
    { day: "Tue", logins: 267, examsTaken: 52, resourcesAccessed: 189 },
    { day: "Wed", logins: 298, examsTaken: 48, resourcesAccessed: 203 },
    { day: "Thu", logins: 312, examsTaken: 61, resourcesAccessed: 234 },
    { day: "Fri", logins: 289, examsTaken: 58, resourcesAccessed: 198 },
    { day: "Sat", logins: 156, examsTaken: 23, resourcesAccessed: 89 },
    { day: "Sun", logins: 134, examsTaken: 18, resourcesAccessed: 67 },
  ]

  const topPerformers = [
    { name: "Alice Johnson", branch: "CS", avgScore: 94.5, examsCompleted: 12 },
    { name: "Bob Chen", branch: "EE", avgScore: 92.8, examsCompleted: 10 },
    { name: "Carol Davis", branch: "CS", avgScore: 91.2, examsCompleted: 14 },
    { name: "David Wilson", branch: "ME", avgScore: 89.7, examsCompleted: 9 },
    { name: "Eva Rodriguez", branch: "CE", avgScore: 88.9, examsCompleted: 11 },
  ]

  const COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#00ff00"]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
          <p className="text-gray-500 dark:text-gray-400">Comprehensive insights into application performance</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2 bg-transparent">
            <Calendar className="h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Analytics Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger>
                <SelectValue placeholder="Date Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last-7-days">Last 7 Days</SelectItem>
                <SelectItem value="last-30-days">Last 30 Days</SelectItem>
                <SelectItem value="last-3-months">Last 3 Months</SelectItem>
                <SelectItem value="last-6-months">Last 6 Months</SelectItem>
                <SelectItem value="last-year">Last Year</SelectItem>
              </SelectContent>
            </Select>

            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                <SelectItem value="cs">Computer Science</SelectItem>
                <SelectItem value="ee">Electrical Engineering</SelectItem>
                <SelectItem value="me">Mechanical Engineering</SelectItem>
                <SelectItem value="ce">Civil Engineering</SelectItem>
              </SelectContent>
            </Select>

            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subjects</SelectItem>
                <SelectItem value="ds">Data Structures</SelectItem>
                <SelectItem value="os">Operating Systems</SelectItem>
                <SelectItem value="db">Database Systems</SelectItem>
                <SelectItem value="cn">Computer Networks</SelectItem>
              </SelectContent>
            </Select>

            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Groups</SelectItem>
                <SelectItem value="fy">First Year</SelectItem>
                <SelectItem value="sy">Second Year</SelectItem>
                <SelectItem value="ty">Third Year</SelectItem>
                <SelectItem value="ly">Final Year</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Students</CardTitle>
            <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewStats.totalStudents.toLocaleString()}</div>
            <p className="text-xs text-green-500">+12% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Exams</CardTitle>
            <FileText className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewStats.totalExams}</div>
            <p className="text-xs text-green-500">+8% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Resources</CardTitle>
            <BookOpen className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewStats.totalResources}</div>
            <p className="text-xs text-green-500">+15% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Average Score</CardTitle>
            <Award className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewStats.avgScore}%</div>
            <p className="text-xs text-green-500">+3% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pass Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewStats.passRate}%</div>
            <p className="text-xs text-green-500">+2% from last month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Activity className="h-4 w-4 text-gray-500 dark:text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overviewStats.activeUsers}</div>
            <p className="text-xs text-green-500">+7% from last month</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="performance" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Subject-wise Performance</CardTitle>
                <CardDescription>Average scores and pass rates by subject</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="subject" angle={-45} textAnchor="end" height={80} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="avgScore" fill="#8884d8" name="Average Score" />
                    <Bar dataKey="passRate" fill="#82ca9d" name="Pass Rate %" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Branch Performance Distribution</CardTitle>
                <CardDescription>Student distribution and performance by branch</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={branchPerformance}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percentage }) => `${name}: ${percentage}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="students"
                    >
                      {branchPerformance.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Monthly Performance Trends</CardTitle>
                <CardDescription>Exam activity and score trends over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={monthlyTrends}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="avgScore" stroke="#8884d8" name="Average Score" />
                    <Line type="monotone" dataKey="exams" stroke="#82ca9d" name="Exams Taken" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Performers</CardTitle>
                <CardDescription>Students with highest average scores</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topPerformers.map((student, index) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-md">
                      <div>
                        <div className="font-medium">{student.name}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {student.branch} • {student.examsCompleted} exams
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-lg">{student.avgScore}%</div>
                        <Badge variant="outline">#{index + 1}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="resources" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Resource Usage Statistics</CardTitle>
                <CardDescription>Download and usage patterns for different resource types</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={resourceUsage}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="downloads" fill="#8884d8" name="Downloads/Usage" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Resource Distribution</CardTitle>
                <CardDescription>Percentage breakdown of resource usage</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={resourceUsage}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percentage }) => `${name}: ${percentage}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="percentage"
                    >
                      {resourceUsage.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Resource Performance Details</CardTitle>
                <CardDescription>Detailed breakdown of resource usage and engagement</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Resource Type</TableHead>
                      <TableHead>Total Items</TableHead>
                      <TableHead>Downloads/Usage</TableHead>
                      <TableHead>Avg. Rating</TableHead>
                      <TableHead>Growth</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>PYQ Papers</TableCell>
                      <TableCell>156</TableCell>
                      <TableCell>2,847</TableCell>
                      <TableCell>4.6/5</TableCell>
                      <TableCell className="text-green-500">+15%</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Faculty Notes</TableCell>
                      <TableCell>89</TableCell>
                      <TableCell>2,156</TableCell>
                      <TableCell>4.8/5</TableCell>
                      <TableCell className="text-green-500">+12%</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Student Notes</TableCell>
                      <TableCell>97</TableCell>
                      <TableCell>1,923</TableCell>
                      <TableCell>4.3/5</TableCell>
                      <TableCell className="text-green-500">+22%</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>AI Helper</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>1,234</TableCell>
                      <TableCell>4.7/5</TableCell>
                      <TableCell className="text-green-500">+35%</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="engagement" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Daily User Engagement</CardTitle>
                <CardDescription>Login patterns and activity throughout the week</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={engagementData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="logins" stackId="1" stroke="#8884d8" fill="#8884d8" />
                    <Area type="monotone" dataKey="examsTaken" stackId="1" stroke="#82ca9d" fill="#82ca9d" />
                    <Area type="monotone" dataKey="resourcesAccessed" stackId="1" stroke="#ffc658" fill="#ffc658" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>User Activity Metrics</CardTitle>
                <CardDescription>Key engagement indicators</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Daily Active Users</span>
                    <span>892 / 1,247 (71.5%)</span>
                  </div>
                  <Progress value={71.5} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Weekly Active Users</span>
                    <span>1,156 / 1,247 (92.7%)</span>
                  </div>
                  <Progress value={92.7} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Monthly Active Users</span>
                    <span>1,203 / 1,247 (96.5%)</span>
                  </div>
                  <Progress value={96.5} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Average Session Duration</span>
                    <span>24 minutes</span>
                  </div>
                  <Progress value={80} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Generate Custom Reports</CardTitle>
                <CardDescription>Create detailed reports based on specific criteria</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Button variant="outline" className="h-20 flex-col gap-2 bg-transparent">
                    <BarChart3 className="h-6 w-6" />
                    <span>Performance Report</span>
                  </Button>
                  <Button variant="outline" className="h-20 flex-col gap-2 bg-transparent">
                    <Download className="h-6 w-6" />
                    <span>Resource Usage Report</span>
                  </Button>
                  <Button variant="outline" className="h-20 flex-col gap-2 bg-transparent">
                    <Users className="h-6 w-6" />
                    <span>User Engagement Report</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Reports</CardTitle>
                <CardDescription>Previously generated reports and exports</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Report Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Generated</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Monthly Performance Summary</TableCell>
                      <TableCell>Performance</TableCell>
                      <TableCell>2024-01-15</TableCell>
                      <TableCell>
                        <Badge className="bg-green-500">Ready</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <Download className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Resource Usage Analysis</TableCell>
                      <TableCell>Resources</TableCell>
                      <TableCell>2024-01-10</TableCell>
                      <TableCell>
                        <Badge className="bg-green-500">Ready</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <Download className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>User Engagement Metrics</TableCell>
                      <TableCell>Engagement</TableCell>
                      <TableCell>2024-01-05</TableCell>
                      <TableCell>
                        <Badge variant="outline">Processing</Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" disabled>
                          <Download className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
