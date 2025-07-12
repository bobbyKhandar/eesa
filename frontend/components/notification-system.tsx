"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Bell, X, AlertCircle, Info, CheckCircle, Clock, Award, BookOpen } from "lucide-react"

interface Notification {
  id: number
  type: "info" | "success" | "warning" | "error"
  title: string
  message: string
  timestamp: Date
  read: boolean
  category: "exam" | "result" | "system" | "reminder" | "achievement"
  actionUrl?: string
}

export function NotificationSystem() {
  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: 1,
      type: "success",
      title: "Exam Result Available",
      message: "Your Data Structures Final exam result is now available. You scored 85%!",
      timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      read: false,
      category: "result",
      actionUrl: "/results/1",
    },
    {
      id: 2,
      type: "info",
      title: "New Study Material",
      message: "Prof. Chen has uploaded new notes for Machine Learning course.",
      timestamp: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      read: false,
      category: "system",
      actionUrl: "/resources",
    },
    {
      id: 3,
      type: "warning",
      title: "Exam Reminder",
      message: "Database Systems midterm exam is scheduled for tomorrow at 10:00 AM.",
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      read: true,
      category: "reminder",
      actionUrl: "/exams",
    },
    {
      id: 4,
      type: "success",
      title: "Achievement Unlocked",
      message: "Congratulations! You've completed 10 practice exams this month.",
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4 hours ago
      read: true,
      category: "achievement",
    },
    {
      id: 5,
      type: "info",
      title: "Study Group Invitation",
      message: "Sarah invited you to join the 'AI Study Group' for collaborative learning.",
      timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
      read: false,
      category: "system",
      actionUrl: "/study-groups",
    },
  ])

  const [isOpen, setIsOpen] = useState(false)

  // Simulate real-time notifications
  useEffect(() => {
    const interval = setInterval(() => {
      // Randomly add new notifications (for demo purposes)
      if (Math.random() < 0.1) {
        // 10% chance every 30 seconds
        const newNotification: Notification = {
          id: Date.now(),
          type: ["info", "success", "warning"][Math.floor(Math.random() * 3)] as "info" | "success" | "warning",
          title: "New Notification",
          message: "This is a real-time notification for demonstration.",
          timestamp: new Date(),
          read: false,
          category: ["exam", "result", "system", "reminder"][Math.floor(Math.random() * 4)] as
            | "exam"
            | "result"
            | "system"
            | "reminder",
        }
        setNotifications((prev) => [newNotification, ...prev])
      }
    }, 30000) // Check every 30 seconds

    return () => clearInterval(interval)
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  const markAsRead = (id: number) => {
    setNotifications((prev) =>
      prev.map((notification) => (notification.id === id ? { ...notification, read: true } : notification)),
    )
  }

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })))
  }

  const deleteNotification = (id: number) => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== id))
  }

  const getNotificationIcon = (type: string, category: string) => {
    if (category === "achievement") return <Award className="h-4 w-4" />
    if (category === "exam") return <BookOpen className="h-4 w-4" />
    if (category === "result") return <CheckCircle className="h-4 w-4" />
    if (category === "reminder") return <Clock className="h-4 w-4" />

    switch (type) {
      case "success":
        return <CheckCircle className="h-4 w-4" />
      case "warning":
        return <AlertCircle className="h-4 w-4" />
      case "error":
        return <AlertCircle className="h-4 w-4" />
      default:
        return <Info className="h-4 w-4" />
    }
  }

  const getNotificationColor = (type: string) => {
    switch (type) {
      case "success":
        return "text-green-600"
      case "warning":
        return "text-yellow-600"
      case "error":
        return "text-red-600"
      default:
        return "text-blue-600"
    }
  }

  const formatTimestamp = (timestamp: Date) => {
    const now = new Date()
    const diffInMinutes = Math.floor((now.getTime() - timestamp.getTime()) / (1000 * 60))

    if (diffInMinutes < 1) return "Just now"
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`
    return `${Math.floor(diffInMinutes / 1440)}d ago`
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs bg-red-500">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllAsRead}>
              Mark all read
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {notifications.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No notifications</p>
          </div>
        ) : (
          <ScrollArea className="h-96">
            <div className="space-y-1">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer border-l-2 ${
                    !notification.read ? "bg-blue-50 dark:bg-blue-950 border-l-blue-500" : "border-l-transparent"
                  }`}
                  onClick={() => {
                    markAsRead(notification.id)
                    if (notification.actionUrl) {
                      window.location.href = notification.actionUrl
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className={getNotificationColor(notification.type)}>
                      {getNotificationIcon(notification.type, notification.category)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium truncate">{notification.title}</p>
                        <div className="flex items-center gap-1">
                          {!notification.read && <div className="w-2 h-2 bg-blue-500 rounded-full"></div>}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteNotification(notification.id)
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{notification.message}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-gray-500">{formatTimestamp(notification.timestamp)}</span>
                        <Badge variant="outline" className="text-xs">
                          {notification.category}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {notifications.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="justify-center">
              <Button variant="ghost" size="sm" className="w-full">
                View All Notifications
              </Button>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
