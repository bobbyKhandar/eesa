"use client"

import type * as React from "react"
import { useState, useEffect, Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Home,
  FileText,
  Calendar,
  BookOpen,
  Brain,
  BarChart3,
  Settings,
  Shield,
  Search,
  Bell,
  ChevronDown,
  LogOut,
  User,
  Activity,
  Crown,
  ArrowRight,
} from "lucide-react"

const navigation = [
  {
    title: "Main",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: Home },
      { title: "Exams", url: "/dashboard/exams", icon: Calendar },
      { title: "Resources", url: "/resources", icon: FileText },
      { title: "Subjects", url: "/subjects", icon: BookOpen },
      { title: "Results", url: "/results", icon: BarChart3 },
      { title: "AI Helper", url: "/ai-helper", icon: Brain },
    ],
  },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      title: "New Exam Available",
      message: "Data Structures Final Exam is now available",
      time: "2 minutes ago",
      read: false,
      type: "exam",
    },
    {
      id: 2,
      title: "Result Published",
      message: "Your Computer Networks exam result is ready",
      time: "1 hour ago",
      read: false,
      type: "result",
    },
    {
      id: 3,
      title: "Resource Updated",
      message: "New study material added for Machine Learning",
      time: "3 hours ago",
      read: true,
      type: "resource",
    },
  ])
  const [isAdmin, setIsAdmin] = useState(true)
  const [showNotifications, setShowNotifications] = useState(false)

  const unreadCount = notifications.filter((n) => !n.read).length

  useEffect(() => {
    // Check if the user is an admin by looking for the mock admin token
    const adminToken = localStorage.getItem("adminToken")
    if (adminToken) {
      setIsAdmin(true)
    } else {
      setIsAdmin(true)
    }
  }, [])

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
      {/* Permanent Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r bg-white dark:bg-gray-950">
        <div className="border-b p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold">AI Exam Evaluator</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Student Dashboard</div>
            </div>
          </div>

          {/* Admin Panel Access Button in Sidebar Header */}
          {isAdmin && (
            <div className="mt-4">
              <Alert className="bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 dark:from-amber-950 dark:to-orange-950 dark:border-amber-800">
                <Crown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-amber-800 dark:text-amber-200">
                  You have admin privileges
                </AlertDescription>
              </Alert>
              <Link href="/admin" className="mt-2 block">
                <Button
                  variant="default"
                  size="sm"
                  className="w-full gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0"
                >
                  <Shield className="h-4 w-4" />
                  Go to Admin Panel
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          )}
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

          {/* Admin Section in Sidebar Navigation */}
          {isAdmin && (
            <div className="px-4 py-2">
              <h2 className="mb-2 text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase flex items-center gap-1">
                <Crown className="h-3 w-3" />
                Adminiddddstration
              </h2>
              <div className="space-y-1">
                <Link href="/admin">
                  <Button
                    variant={pathname.startsWith("/admin") ? "default" : "ghost"}
                    className="w-full justify-start gap-2 bg-gradient-to-r from-amber-50 to-orange-50 hover:from-amber-100 hover:to-orange-100 dark:from-amber-950 dark:to-orange-950 dark:hover:from-amber-900 dark:hover:to-orange-900 border border-amber-200 dark:border-amber-800"
                  >
                    <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-amber-800 dark:text-amber-200 font-medium">Admin Panel</span>
                    <ArrowRight className="h-3 w-3 ml-auto text-amber-600 dark:text-amber-400" />
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-4">
          <Suspense fallback={<div>Loading...</div>}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src="/placeholder.svg?height=24&width=24" />
                    <AvatarFallback>JD</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium flex items-center gap-1">
                      John Doe
                      {isAdmin && <Crown className="h-3 w-3 text-amber-500" />}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">john.doe@university.edu</div>
                  </div>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {isAdmin && (
                  <>
                    <DropdownMenuItem
                      asChild
                      className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950"
                    >
                      <Link href="/admin" className="flex items-center">
                        <Shield className="h-4 w-4 mr-2 text-amber-600 dark:text-amber-400" />
                        <span className="text-amber-800 dark:text-amber-200 font-medium">Go to Admin Panel</span>
                        <ArrowRight className="h-3 w-3 ml-auto text-amber-600 dark:text-amber-400" />
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
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
                <Input placeholder="Search..." className="pl-8" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Admin Panel Access Button in Header */}
              {isAdmin && (
                <Link href="/admin">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 hover:from-amber-100 hover:to-orange-100 dark:from-amber-950 dark:to-orange-950 dark:border-amber-800 dark:hover:from-amber-900 dark:hover:to-orange-900"
                  >
                    <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="hidden sm:inline text-amber-800 dark:text-amber-200 font-medium">Admin Panel</span>
                    <span className="sm:hidden text-amber-800 dark:text-amber-200 font-medium">Admin</span>
                    <ArrowRight className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  </Button>
                </Link>
              )}

              {/* Notifications Dropdown */}
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
                    <h3 className="font-semibold">Notifications</h3>
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
                              notification.type === "exam"
                                ? "bg-green-500"
                                : notification.type === "result"
                                  ? "bg-blue-500"
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
                        <AvatarFallback>JD</AvatarFallback>
                      </Avatar>
                      <span className="hidden md:inline flex items-center gap-1">
                        John Doe
                        {isAdmin && <Crown className="h-3 w-3 text-amber-500" />}
                      </span>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {isAdmin && (
                      <>
                        <DropdownMenuItem
                          asChild
                          className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950"
                        >
                          <Link href="/admin" className="flex items-center">
                            <Shield className="h-4 w-4 mr-2 text-amber-600 dark:text-amber-400" />
                            <span className="text-amber-800 dark:text-amber-200 font-medium">Go to Admin Panel</span>
                            <ArrowRight className="h-3 w-3 ml-auto text-amber-600 dark:text-amber-400" />
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
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
