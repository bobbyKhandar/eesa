"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Users, FileText, Calendar, Activity, Database, Server, Zap } from "lucide-react"

export default function AdminDashboard() {
  const [systemStatus] = useState({
    server: "online",
    database: "online",
    ai: "online",
    storage: "warning",
  })

  const stats = [
    {
      title: "Total Users",
      value: "2,847",
      change: "+12%",
      trend: "up",
      icon: Users,
      color: "text-blue-600",
    },
    {
      title: "Active Exams",
      value: "156",
      change: "+8%",
      trend: "up",
      icon: Calendar,
      color: "text-green-600",
    },
    {
      title: "Resources",
      value: "1,234",
      change: "+23%",
      trend: "up",
      icon: FileText,
      color: "text-purple-600",
    },
    {
      title: "System Load",
      value: "67%",
      change: "-5%",
      trend: "down",
      icon: Activity,
      color: "text-orange-600",
    },
  ]

  const recentActivities = [
    {
      id: 1,
      action: "New user registration",
      user: "john.doe@university.edu",
      time: "2 minutes ago",
      type: "user",
    },
    {
      id: 2,
      action: "Exam completed",
      user: "Data Structures Final",
      time: "5 minutes ago",
      type: "exam",
    },
    {
      id: 3,
      action: "Resource uploaded",
      user: "Machine Learning Notes",
      time: "10 minutes ago",
      type: "resource",
    },
    {
      id: 4,
      action: "System backup completed",
      user: "Automated backup",
      time: "1 hour ago",
      type: "system",
    },
  ]

  const systemMetrics = [
    { name: "CPU Usage", value: 45, status: "good" },
    { name: "Memory Usage", value: 67, status: "warning" },
    { name: "Disk Usage", value: 23, status: "good" },
    { name: "Network I/O", value: 89, status: "critical" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400">Monitor and manage your AI Exam Evaluator platform</p>
      </div>

      {/* System Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            System Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${systemStatus.server === "online" ? "bg-green-500" : "bg-red-500"}`}
              />
              <span className="text-sm">Web Server</span>
              <Badge variant={systemStatus.server === "online" ? "default" : "destructive"}>
                {systemStatus.server}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${systemStatus.database === "online" ? "bg-green-500" : "bg-red-500"}`}
              />
              <span className="text-sm">Database</span>
              <Badge variant={systemStatus.database === "online" ? "default" : "destructive"}>
                {systemStatus.database}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${systemStatus.ai === "online" ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-sm">AI Service</span>
              <Badge variant={systemStatus.ai === "online" ? "default" : "destructive"}>{systemStatus.ai}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  systemStatus.storage === "online"
                    ? "bg-green-500"
                    : systemStatus.storage === "warning"
                      ? "bg-yellow-500"
                      : "bg-red-500"
                }`}
              />
              <span className="text-sm">Storage</span>
              <Badge
                variant={
                  systemStatus.storage === "online"
                    ? "default"
                    : systemStatus.storage === "warning"
                      ? "secondary"
                      : "destructive"
                }
              >
                {systemStatus.storage}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className={`text-xs ${stat.trend === "up" ? "text-green-600" : "text-red-600"}`}>
                {stat.change} from last month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Recent Activity
            </CardTitle>
            <CardDescription>Latest system activities and user actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivities.map((activity) => (
                <div key={activity.id} className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      activity.type === "user"
                        ? "bg-blue-500"
                        : activity.type === "exam"
                          ? "bg-green-500"
                          : activity.type === "resource"
                            ? "bg-purple-500"
                            : "bg-gray-500"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{activity.action}</div>
                    <div className="text-xs text-gray-500">{activity.user}</div>
                  </div>
                  <div className="text-xs text-gray-500">{activity.time}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* System Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              System Metrics
            </CardTitle>
            <CardDescription>Real-time system performance monitoring</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {systemMetrics.map((metric) => (
                <div key={metric.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{metric.name}</span>
                    <span className="text-sm text-gray-500">{metric.value}%</span>
                  </div>
                  <Progress
                    value={metric.value}
                    className={`h-2 ${
                      metric.status === "good"
                        ? "[&>div]:bg-green-500"
                        : metric.status === "warning"
                          ? "[&>div]:bg-yellow-500"
                          : "[&>div]:bg-red-500"
                    }`}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common administrative tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Button className="h-20 flex-col gap-2">
              <Users className="h-6 w-6" />
              Manage Users
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-2 bg-transparent">
              <Calendar className="h-6 w-6" />
              Create Exam
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-2 bg-transparent">
              <FileText className="h-6 w-6" />
              Review Resources
            </Button>
            <Button variant="outline" className="h-20 flex-col gap-2 bg-transparent">
              <Database className="h-6 w-6" />
              Backup System
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
