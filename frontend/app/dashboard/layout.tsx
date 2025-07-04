import type { ReactNode } from "react";
import Link from "next/link";
import {
  Brain,
  Home,
  BookOpen,
  FileText,
  BarChart3,
  Settings,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-64 flex-col border-r bg-gray-50 dark:bg-gray-900">
        <div className="flex h-16 items-center border-b px-6">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold">
            <Brain className="h-6 w-6" />
            <span>AI Exam Evaluator</span>
          </Link>
        </div>
        <nav className="flex-1 overflow-auto py-4">
          <div className="px-4 py-2">
            <h2 className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
              Dashboard
            </h2>
            <div className="space-y-1">
              <Link href="/dashboard">
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <Home className="h-4 w-4" />
                  Overview
                </Button>
              </Link>
              <Link href="/dashboard/exams">
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <BookOpen className="h-4 w-4" />
                  Exams
                </Button>
              </Link>
              <Link href="/dashboard/results">
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <FileText className="h-4 w-4" />
                  Results
                </Button>
              </Link>
              <Link href="/dashboard/analytics">
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Analytics
                </Button>
              </Link>
            </div>
          </div>
          <div className="px-4 py-2">
            <h2 className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
              Settings
            </h2>
            <div className="space-y-1">
              <Link href="/dashboard/settings">
                <Button variant="ghost" className="w-full justify-start gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </Link>
              <Button variant="ghost" className="w-full justify-start gap-2">
                <LogOut className="h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center border-b px-6">
          <Button variant="outline" size="icon" className="md:hidden">
            <Brain className="h-5 w-5" />
            <span className="sr-only">Menu</span>
          </Button>
          <div className="ml-auto flex items-center gap-4">
            <Button variant="ghost" size="sm">
              Help
            </Button>
            <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-800" />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
