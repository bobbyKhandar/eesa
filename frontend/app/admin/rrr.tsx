"use client"

import type React from "react"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Suspense } from "react"
import {
  BarChart3,
  Users,
  FileText,
  Calendar,
  Settings,
  Database,
  Shield,
  Bell,
  Search,
  LogOut,
  User,
  ChevronDown,
  Home,
  Activity,
  ArrowLeft,
} from "lucide-react"

const navigation = [
  {
    title: "Overview",
    items: [
      { title: "Dashboard", url: "/admin", icon: Home },
      { title: "Analytics", url: "/admin/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Management",
    items: [
      { title: "Users", url: "/admin/users", icon: Users },
      { title: "Resources", url: "/admin/resources", icon: FileText },
      { title: "Exams", url: "/admin/exams", icon: Calendar },
    ],
  },
  {
    title: "System",
    items: [
      { title: "Settings", url: "/admin/settings", icon: Settings },
      { title: "Database", url: "/admin/database", icon: Database },
    ],
  },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      title: "New User Registration",
      message: "5 new users registered in the last hour",
      time: "5 minutes ago",
      read: false,
      type: "user",
    },
    {
      id: 2,
      title: "System Alert",
      message: "Database backup completed successfully",
      time: "30 minutes ago",
      read: false,
      type: "system",
    },
    {
      id: 3,
      title: "Resource Uploaded",
      message: "New study material pending approval",
      time: "1 hour ago",
      read: true,
      type: "resource",
    },
  ])
  const [showNotifications, setShowNotifications] = useState(false)

  const unreadCount = notifications.filter((n) => !n.read).length

  const markAsRead = (id: number) => {
    setNotifications((prev) =>
      prev.map((notification) => (notification.id === id ? { ...notification, read: true } : notification)),
    )
  }

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })))
  }

  return (
    <div className="flex min-h-screen w-full">
      {/* Permanent Admin Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r bg-white dark:bg-gray-950">
        <div className="border-b p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold">Admin Panel</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">AI Exam Evaluator</div>
            </div>
          </div>

          {/* Back to Main Menu Button in Sidebar */}
          <div className="mt-4">
            <Link href="/dashboard">
              <Button variant="outline" size="sm" className="w-full gap-2 bg-transparent">
                <ArrowLeft className="h-4 w-4" />
                Back to Main Menu
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex-1 overflow-auto py-4">
          {navigation.map((group) => (
            <div key={group.title} className="px-4 py-2">
              <h2 className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">{group.title}</h2>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <Link key={item.title} href={item.url}>
                    <Button
                      variant={pathname === item.url ? "default" : "ghost"}
                      className="w-full justify-start gap-2"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Button>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t p-4">
          <Suspense fallback={<div>Loading...</div>}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src="/placeholder.svg?height=24&width=24" />
                    <AvatarFallback>AD</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium">Admin User</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">admin@university.edu</div>
                  </div>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem asChild>
                  <Link href="/dashboard" className="flex items-center">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Main Menu
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <User className="h-4 w-4 mr-2" />
                  Profile Settings
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="h-4 w-4 mr-2" />
                  Preferences
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Activity className="h-4 w-4 mr-2" />
                  Activity Log
                </DropdownMenuItem>
                <DropdownMenuItem className="text-red-600">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Suspense>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-16 items-center gap-4 px-6">
            <div className="flex-1 flex items-center gap-4">
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
                <Input placeholder="Search admin panel..." className="pl-8" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Prominent Back to Main Menu Button in Header */}
              <Link href="/dashboard">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 bg-primary/5 border-primary/20 hover:bg-primary/10"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Back to Main Menu</span>
                  <span className="sm:hidden">Main</span>
                </Button>
              </Link>

              {/* Admin Notifications */}
              <DropdownMenu open={showNotifications} onOpenChange={setShowNotifications}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="relative">
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 text-xs">{unreadCount}</Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <div className="flex items-center justify-between p-3 border-b">
                    <h3 className="font-semibold">Admin Notifications</h3>
                    {unreadCount > 0 && (
                      <Button variant="ghost" size="sm" onClick={markAllAsRead}>
                        Mark all as read
                      </Button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`p-3 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${
                          !notification.read ? "bg-blue-50 dark:bg-blue-950" : ""
                        }`}
                        onClick={() => markAsRead(notification.id)}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`w-2 h-2 rounded-full mt-2 ${
                              notification.type === "user"
                                ? "bg-green-500"
                                : notification.type === "system"
                                  ? "bg-red-500"
                                  : "bg-orange-500"
                            }`}
                          />
                          <div className="flex-1">
                            <div className="font-medium text-sm">{notification.title}</div>
                            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{notification.message}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">{notification.time}</div>
                          </div>
                          {!notification.read && <div className="w-2 h-2 bg-blue-500 rounded-full" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>

              <Suspense fallback={<div>Loading...</div>}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src="/placeholder.svg?height=24&width=24" />
                        <AvatarFallback>AD</AvatarFallback>
                      </Avatar>
                      <span className="hidden md:inline">Admin</span>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard" className="flex items-center">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Main Menu
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <User className="h-4 w-4 mr-2" />
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Settings className="h-4 w-4 mr-2" />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-red-600">
                      <LogOut className="h-4 w-4 mr-2" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Suspense>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
