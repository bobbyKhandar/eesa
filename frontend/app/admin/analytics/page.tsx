"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { Users, Calendar, TrendingUp, Download, Award } from "lucide-react"

export default function AdminAnalytics() {
  const [dateRange, setDateRange] = useState("30d")
  const [selectedSubject, setSelectedSubject] = useState("all")

  // Mock data for charts
  const userEngagementData = [
    { name: "Jan", activeUsers: 1200, newUsers: 180, examsTaken: 450 },
    { name: "Feb", activeUsers: 1350, newUsers: 220, examsTaken: 520 },
    { name: "Mar", activeUsers: 1480, newUsers: 190, examsTaken: 680 },
    { name: "Apr", activeUsers: 1620, newUsers: 250, examsTaken: 750 },
    { name: "May", activeUsers: 1750, newUsers: 280, examsTaken: 820 },
    { name: "Jun", activeUsers: 1890, newUsers: 320, examsTaken: 950 },
  ]

  const performanceData = [
    { subject: "Mathematics", avgScore: 78, submissions: 245, passRate: 82 },
    { subject: "Physics", avgScore: 72, submissions: 189, passRate: 75 },
    { subject: "Chemistry", avgScore: 85, submissions: 156, passRate: 88 },
    { subject: "Biology", avgScore: 80, submissions: 203, passRate: 85 },
    { subject: "Computer Science", avgScore: 88, submissions: 167, passRate: 92 },
  ]

  const resourceUsageData = [
    { name: "PDFs", value: 45, downloads: 2340 },
    { name: "Videos", value: 30, downloads: 1560 },
    { name: "Presentations", value: 15, downloads: 780 },
    { name: "Audio", value: 10, downloads: 520 },
  ]

  const examTrendsData = [
    { date: "2024-01", completed: 120, started: 150, avgDuration: 45 },
    { date: "2024-02", completed: 135, started: 165, avgDuration: 42 },
    { date: "2024-03", completed: 158, started: 180, avgDuration: 48 },
    { date: "2024-04", completed: 172, started: 195, avgDuration: 44 },
    { date: "2024-05", completed: 189, started: 210, avgDuration: 46 },
    { date: "2024-06", completed: 205, started: 225, avgDuration: 43 },
  ]

  const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042"]

  const keyMetrics = [
    {
      title: "Total Users",
      value: "2,847",
      change: "+12.5%",
      icon: Users,
      description: "Active users this month",
    },
    {
      title: "Exams Completed",
      value: "1,234",
      change: "+8.2%",
      icon: Calendar,
      description: "Total completed exams",
    },
    {
      title: "Avg. Score",
      value: "78.5%",
      change: "+3.1%",
      icon: Award,
      description: "Average exam score",
    },
    {
      title: "Resources Downloaded",
      value: "5,678",
      change: "+15.3%",
      icon: Download,
      description: "Total resource downloads",
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
          <p className="text-muted-foreground">Comprehensive insights into platform performance and user engagement</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {keyMetrics.map((metric) => (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                <Badge variant="secondary" className="text-green-600 bg-green-50">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  {metric.change}
                </Badge>
                <span>from last period</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{metric.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Analytics Tabs */}
      <Tabs defaultValue="engagement" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="engagement">User Engagement</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="exams">Exam Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="engagement" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>User Engagement Overview</CardTitle>
              <CardDescription>Track user activity and engagement metrics over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={userEngagementData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="activeUsers" stackId="1" stroke="#8884d8" fill="#8884d8" />
                  <Area type="monotone" dataKey="newUsers" stackId="1" stroke="#82ca9d" fill="#82ca9d" />
                  <Area type="monotone" dataKey="examsTaken" stackId="1" stroke="#ffc658" fill="#ffc658" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Subject Performance</CardTitle>
                <CardDescription>Average scores and pass rates by subject</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={performanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="subject" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="avgScore" fill="#8884d8" />
                    <Bar dataKey="passRate" fill="#82ca9d" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Submission Statistics</CardTitle>
                <CardDescription>Number of exam submissions by subject</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={performanceData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="submissions"
                    >
                      {performanceData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="resources" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Resource Usage Distribution</CardTitle>
                <CardDescription>Breakdown of resource types and usage</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={resourceUsageData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {resourceUsageData.map((entry, index) => (
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
                <CardTitle>Download Statistics</CardTitle>
                <CardDescription>Total downloads by resource type</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {resourceUsageData.map((resource, index) => (
                    <div key={resource.name} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="font-medium">{resource.name}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{resource.downloads.toLocaleString()}</div>
                        <div className="text-sm text-muted-foreground">{resource.value}% of total</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="exams" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Exam Completion Trends</CardTitle>
              <CardDescription>Track exam completion rates and average duration over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={examTrendsData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="completed" fill="#8884d8" />
                  <Bar yAxisId="left" dataKey="started" fill="#82ca9d" />
                  <Line yAxisId="right" type="monotone" dataKey="avgDuration" stroke="#ff7300" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
