"use client"

import { Brain, Menu, X } from "lucide-react"
import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/nextjs"
import { Button } from "@/frontend/components/ui/button"
import { DialogTrigger } from "@/frontend/components/ui/dialog"
import { GlobalSearch } from "@/frontend/components/global-search"
import { ResultNotifications } from "@/frontend/components/result-notifications"

interface TopNavigationProps { isMobileMenuOpen?: boolean }

export function TopNavigation({ isMobileMenuOpen }: TopNavigationProps) {
  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 fixed top-0 left-0 right-0 z-50">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Open navigation" aria-controls="mobile-navigation" aria-expanded={isMobileMenuOpen}>
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </DialogTrigger>
          <Brain className="h-6 w-6 shrink-0" />
          <span className="text-sm sm:text-base">AI Exam Evaluator</span>
        </div>
        <GlobalSearch />
        <div className="flex items-center gap-2">
          <ResultNotifications />
          <SignedOut><SignInButton><Button size="sm">Login</Button></SignInButton></SignedOut>
          <SignedIn><UserButton /></SignedIn>
        </div>
      </div>
    </nav>
  )
}
