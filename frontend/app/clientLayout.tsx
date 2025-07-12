"use client"

import type React from "react"
import { useState } from "react"
import { Inter } from "next/font/google"
import "./globals.css"
import { PermanentSidebar } from "@/components/permanent-sidebar"
import { TopNavigation } from "@/components/top-navigation"

const inter = Inter({ subsets: ["latin"] })

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen)
  }

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false)
  }

  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
          {/* Top Navigation */}
          <TopNavigation onMobileMenuToggle={toggleMobileMenu} isMobileMenuOpen={isMobileMenuOpen} />

          {/* Desktop Sidebar */}
          <div className="hidden lg:block">
            <PermanentSidebar />
          </div>

          {/* Mobile Sidebar */}

          {/* Main Content */}
          <main className="flex-1 lg:ml-64 pt-16 overflow-auto">
            <div className="p-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  )
}