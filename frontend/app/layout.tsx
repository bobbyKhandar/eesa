import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { PermanentSidebar } from "@/frontend/components/permanent-sidebar"
import {  ClerkProvider} from '@clerk/nextjs'
import Link from "next/link"
import { Button } from "@/frontend/components/ui/button"
import { Brain } from "lucide-react"
import ClientLayout from "./clientLayout"
const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "AI Exam Evaluator",
  description: "Intelligent exam evaluation and learning platform",
    generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return<>
  <ClerkProvider><ClientLayout>{children}</ClientLayout></ClerkProvider>
  </>
    
}
