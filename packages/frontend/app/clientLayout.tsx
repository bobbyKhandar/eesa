"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Inter } from "next/font/google"
import "./globals.css"
import { PermanentSidebar } from "@/frontend/components/permanent-sidebar"
import { TopNavigation } from "@/frontend/components/top-navigation"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/frontend/components/ui/dialog"

const inter = Inter({ subsets: ["latin"] })

export default function ClientLayout({
  children,
  isAdmin = false,
}: {
  children: React.ReactNode
  /** Resolved server-side in app/layout.tsx; hides the admin-only nav section. */
  isAdmin?: boolean
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)")
    const closeOnDesktop = () => {
      if (desktop.matches) setIsMobileMenuOpen(false)
    }
    desktop.addEventListener("change", closeOnDesktop)
    return () => desktop.removeEventListener("change", closeOnDesktop)
  }, [])

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false)
  }

  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
          <Dialog open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            {/* Top Navigation */}
            <TopNavigation isMobileMenuOpen={isMobileMenuOpen} />

            {/* Desktop Sidebar */}
            <div className="hidden lg:block">
              <PermanentSidebar isAdmin={isAdmin} />
            </div>

            {/* Mobile Sidebar */}
            <DialogContent id="mobile-navigation" className="left-0 top-0 h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 grid-rows-[auto_1fr] gap-0 rounded-none p-0 sm:rounded-none">
              <div className="px-4 py-5">
                <DialogTitle>Navigation</DialogTitle>
                <DialogDescription className="sr-only">Choose a page to visit.</DialogDescription>
              </div>
              <PermanentSidebar isAdmin={isAdmin} embedded onNavigate={closeMobileMenu} />
            </DialogContent>
          </Dialog>

          {/* Main Content */}
          <main className="flex-1 lg:ml-64 pt-16 overflow-auto">
            <div className="p-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  )
}
