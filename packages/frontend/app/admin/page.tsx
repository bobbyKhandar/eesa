"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Users, UserCheck, UserX, Crown } from "lucide-react"
import type { AdminUserCounts } from "@/frontend/lib/adminUserList"

const EMPTY: AdminUserCounts = { total: 0, active: 0, inactive: 0, suspended: 0, admins: 0 }

export default function AdminDashboard() {
  const [counts, setCounts] = useState<AdminUserCounts>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetch("/api/admin/users")
        const data = await response.json().catch(() => null)
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || "Failed to load counts")
        }
        if (active) setCounts(data.counts ?? EMPTY)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load counts")
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const stats = [
    { title: "Total users", value: counts.total, icon: Users, href: "/admin/users" },
    { title: "Active", value: counts.active, icon: UserCheck, href: "/admin/users" },
    { title: "Inactive", value: counts.inactive, icon: UserX, href: "/admin/users" },
    { title: "Admins", value: counts.admins, icon: Crown, href: "/admin/users" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="text-muted-foreground">Counts come from the user collection</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.title} href={stat.href}>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Where to go</CardTitle>
          <CardDescription>Each screen reads stored records. None of these numbers are samples.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Link className="underline" href="/admin/users">Users</Link>
          <Link className="underline" href="/admin/resources">Resources</Link>
          <Link className="underline" href="/admin/database">Database</Link>
        </CardContent>
      </Card>
    </div>
  )
}
