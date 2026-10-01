import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'

/**
 * Server-side gate for the whole /dashboard segment. The middleware already
 * redirects anonymous page requests; this re-checks the session so the segment
 * can never render for a signed-out visitor even if the matcher changes.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth()

  if (!userId) {
    redirect('/sign-in?redirect_url=/dashboard')
  }

  return <>{children}</>
}