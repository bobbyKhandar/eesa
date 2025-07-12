"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home,
  BookOpen,
  FileText,
  BarChart3,
  Users,
  Settings,
  HelpCircle,
  GraduationCap,
  Brain,
  Shield,
  Database,
  TrendingUp,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

const navigationItems = [
  {
    title: "Main",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: Home },
      { name: "Exams", href: "/exams", icon: FileText },
      { name: "Results", href: "/results", icon: BarChart3 },
      { name: "Subjects", href: "/subjects", icon: BookOpen },
      { name: "Resources", href: "/resources", icon: GraduationCap },
      { name: "AI Helper", href: "/ai-helper", icon: Brain },
    ],
  },
  {
    title: "Management",
    items: [
      { name: "Analytics", href: "/dashboard/analytics", icon: TrendingUp },
      { name: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
  {
    title: "Admin",
    items: [
      { name: "Admin Panel", href: "/admin", icon: Shield },
      { name: "User Management", href: "/admin/users", icon: Users },
      { name: "System Analytics", href: "/admin/analytics", icon: BarChart3 },
      { name: "Database", href: "/admin/database", icon: Database },
    ],
  },
]

const recentResults = [
  { id: 1, exam: "Mathematics Quiz", score: 85, date: "2024-01-15" },
  { id: 2, exam: "Physics Test", score: 92, date: "2024-01-14" },
  { id: 3, exam: "Chemistry Lab", score: 78, date: "2024-01-13" },
]

export function PermanentSidebar() {
  const pathname = usePathname()

  return (
    <div className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 lg:block">
      <ScrollArea className="h-full">
        <div className="p-4 space-y-6">
          {/* Navigation */}
          <div className="space-y-6">
            {navigationItems.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  {section.title}
                </h3>
                <nav className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = pathname === item.href
                    return (
                      <Link key={item.name} href={item.href}>
                        <Button
                          variant={isActive ? "secondary" : "ghost"}
                          className={cn(
                            "w-full justify-start h-9 px-3",
                            isActive && "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300",
                          )}
                        >
                          <item.icon className="mr-3 h-4 w-4" />
                          {item.name}
                        </Button>
                      </Link>
                    )
                  })}
                </nav>
              </div>
            ))}
          </div>

          <Separator />

          {/* Recent Results */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Recent Results
            </h3>
            <div className="space-y-2">
              {recentResults.map((result) => (
                <div key={result.id} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{result.exam}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{result.date}</p>
                    </div>
                    <div
                      className={cn(
                        "text-sm font-semibold px-2 py-1 rounded",
                        result.score >= 90
                          ? "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/20"
                          : result.score >= 80
                            ? "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/20"
                            : result.score >= 70
                              ? "text-yellow-700 bg-yellow-100 dark:text-yellow-300 dark:bg-yellow-900/20"
                              : "text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/20",
                      )}
                    >
                      {result.score}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Help & Support */}
          <div>
            <Link href="/help">
              <Button variant="ghost" className="w-full justify-start h-9 px-3">
                <HelpCircle className="mr-3 h-4 w-4" />
                Help & Support
              </Button>
            </Link>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
