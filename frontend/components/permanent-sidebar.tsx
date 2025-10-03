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
import { cn } from "@/frontend/lib/utils"
import { Button } from "@/frontend/components/ui/button"
import { ScrollArea } from "@/frontend/components/ui/scroll-area"
import { Separator } from "@/frontend/components/ui/separator"

const navigationItems = [
  {
    title: "Main",
    items: [
      { name: "Dashboard", href: "/dashboard", icon: Home },
      { name: "Exams", href: "/dashboard/exams", icon: FileText },
      { name: "Results", href: "/results", icon: BarChart3 },
      { name: "Subjects", href: "/subjects", icon: BookOpen },
      { name: "Resources", href: "/resources", icon: GraduationCap },
      { name: "AI Helper", href: "/ai-helper", icon: Brain },
    ],
  }
]
//   {
//     title: "Management",
//     items: [
//       { name: "Analytics", href: "/dashboard/analytics", icon: TrendingUp },
//       { name: "Settings", href: "/dashboard/settings", icon: Settings },
//     ],
//   },
//   {
//     title: "Admin",
//     items: [
//       { name: "Admin Panel", href: "/admin", icon: Shield },
//       { name: "User Management", href: "/admin/users", icon: Users },
//       { name: "System Analytics", href: "/admin/analytics", icon: BarChart3 },
//       { name: "Database", href: "/admin/database", icon: Database },
//     ],
//   },
// ]

// const recentResults = [
//   { id: 1, exam: "Mathematics Quiz", score: 85, date: "2024-01-15" },
//   { id: 2, exam: "Physics Test", score: 92, date: "2024-01-14" },
//   { id: 3, exam: "Chemistry Lab", score: 78, date: "2024-01-13" },
// ]

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



        </div>
      </ScrollArea>
    </div>
  )
}
