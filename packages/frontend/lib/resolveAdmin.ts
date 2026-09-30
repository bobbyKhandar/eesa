import { auth } from "@clerk/nextjs/server";
import { userRepo } from "@/backend/dist/database/repositories/index.js";
import { isAdminRole } from "@/frontend/lib/adminAccess";

/**
 * Resolve whether the current session belongs to an admin.
 *
 * Server-side only (imports Clerk and the user repository). The user document's
 * `_id` is the Clerk user id, so `getById` is the lookup — see
 * `UserRepository.upsertByClerkId`.
 *
 * Fails closed: no session, a missing record (the account has not been
 * provisioned yet) or a database failure all resolve to `false`.
 */
export async function resolveIsAdmin(): Promise<boolean> {
  try {
    const { userId } = await auth();

    if (!userId) {
      return false;
    }

    const record = await userRepo.getById(userId);

    return isAdminRole(record?.role);
  } catch (error) {
    console.error("Failed to resolve admin role:", error);
    return false;
  }
}
