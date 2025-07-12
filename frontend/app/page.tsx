import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, Brain, CheckCircle, Clock } from "lucide-react"
import {

  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs'

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen">
      
      <main className="flex-1">
        <section className="py-20 md:py-32 bg-gradient-to-b from-white to-gray-50 dark:from-gray-950 dark:to-gray-900">
          <div className="container px-4 md:px-6">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl">
                  Revolutionize Exam Evaluation with AI
                </h1>
                <p className="mx-auto max-w-[700px] text-gray-500 md:text-xl dark:text-gray-400">
                  Create, conduct, and evaluate exams with the power of artificial intelligence. Get instant feedback
                  and detailed analysis.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/dashboard">
                <SignInButton>
                  
                  <Button size="lg" className="gap-1" >
                    Get Started <ArrowRight className="h-4 w-4" />
                  </Button>
                </SignInButton>
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 md:py-24">
          <div className="container px-4 md:px-6">
            <div className="grid gap-10 md:grid-cols-3">
              <div className="flex flex-col items-center space-y-4 text-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">AI-Powered Evaluation</h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Our advanced AI algorithms evaluate responses with human-like understanding and provide detailed
                    feedback.
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-center space-y-4 text-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <Clock className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">Save Time</h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Reduce grading time by up to 90% while maintaining high evaluation standards and consistency.
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-center space-y-4 text-center">
                <div className="rounded-full bg-primary/10 p-4">
                  <CheckCircle className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">Detailed Analytics</h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Get comprehensive insights into student performance with detailed analytics and reports.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t py-6">
        <div className="container flex flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-sm text-gray-500 dark:text-gray-400">© 2025 AI Exam Evaluator. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="text-sm text-gray-500 hover:underline dark:text-gray-400">
              Terms
            </Link>
            <Link href="/privacy" className="text-sm text-gray-500 hover:underline dark:text-gray-400">
              Privacy
            </Link>
            <Link href="/contact" className="text-sm text-gray-500 hover:underline dark:text-gray-400">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
