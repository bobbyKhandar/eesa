import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { resolveIsAdmin } from "@/frontend/lib/resolveAdmin";

/**
 * Gate for the whole `/admin` segment.
 *
 * The admin pages are Client Components that render their own mock data, so
 * without this layout any signed-in user could navigate straight to
 * `/admin`, `/admin/users`, `/admin/database` and read them. Middleware only
 * proves a session exists; the role has to come from the user record, which
 * means the database — not available on the edge runtime the middleware runs
 * on. Hence a server layout, mirroring `app/dashboard/layout.tsx`.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in?redirect_url=/admin");
  }

  if (!(await resolveIsAdmin())) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
