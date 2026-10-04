"use client"

import type React from "react"
import { useState } from "react"
import { Search, Bell, Settings, LogOut, User, Menu, X } from "lucide-react"
import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { DialogTrigger } from "@/frontend/components/ui/dialog"
import { GlobalSearch } from "@/frontend/components/global-search"
import {

  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/frontend/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/frontend/components/ui/avatar"
import { Badge } from "@/frontend/components/ui/badge"
import { Brain } from "lucide-react"
interface TopNavigationProps {
  isMobileMenuOpen?: boolean
}

export function TopNavigation({ isMobileMenuOpen }: TopNavigationProps) {
  const [notifications] = useState([
    { id: 1, title: "New exam result available", time: "2 min ago", unread: true },
    { id: 2, title: "Assignment deadline reminder", time: "1 hour ago", unread: true },
    { id: 3, title: "Study group invitation", time: "3 hours ago", unread: false },
  ])

  const unreadCount = notifications.filter((n) => n.unread).length


  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 fixed top-0 left-0 right-0 z-50">
      <div className="flex items-center justify-between">
        {/* Left Section - Logo and Mobile Menu */}
        <div className="flex items-center space-x-4">
          {/* Mobile Menu Toggle */}
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Open navigation" aria-controls="mobile-navigation" aria-expanded={isMobileMenuOpen}>
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </DialogTrigger>

          {/* Logo */}
            <Brain className="h-6 w-6" />
            <span>AI Exam Evaluator</span>
        </div>

        {/* Center Section - Search Bar */}
        <GlobalSearch />

        {/* Right Section - Notifications and User Profile */}
        <div className="flex items-center space-x-3">

          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="relative">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
                  >
                    {unreadCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                Notifications
                <Badge variant="secondary">{unreadCount} new</Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.map((notification) => (
                <DropdownMenuItem key={notification.id} className="flex flex-col items-start p-3">
                  <div className="flex items-center justify-between w-full">
                    <span className={`text-sm ${notification.unread ? "font-medium" : "font-normal"}`}>
                      {notification.title}
                    </span>
                    {notification.unread && <div className="w-2 h-2 bg-blue-500 rounded-full"></div>}
                  </div>
                  <span className="text-xs text-gray-500 mt-1">{notification.time}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-center text-blue-600 hover:text-blue-700">
                View all notifications
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Profile */}
            <SignedOut>
            <SignInButton>
               <Button  size="sm"  className="gap-2">
                Login
              </Button>
            </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton/>
            </SignedIn>
        </div>
      </div>

    </nav>
  )
}
