import type React from "react"
import type { Metadata } from "next"
import "./globals.css"
import {  ClerkProvider} from '@clerk/nextjs'
import ClientLayout from "./clientLayout"
import { resolveIsAdmin } from "@/frontend/lib/resolveAdmin"

export const metadata: Metadata = {
  title: "AI Exam Evaluator",
  description: "Intelligent exam evaluation and learning platform",
    generator: 'v0.dev'
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Sidebar only. The /admin segment is gated by app/admin/layout.tsx.
  const isAdmin = await resolveIsAdmin()

  return<>
  <ClerkProvider><ClientLayout isAdmin={isAdmin}>{children}</ClientLayout></ClerkProvider>
  </>
    
}
