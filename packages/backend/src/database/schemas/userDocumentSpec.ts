/**
 * User document field inventory — dependency-free source of truth.
 *
 * `userSchemaZod.ts` builds the Zod schema from these constants. They live
 * here (no `zod` import) so the defaults and the status bookkeeping can be
 * exercised by unit tests without a database or the Zod runtime.
 *
 * Why this exists: Zod strips unknown keys. `userZodSchema` used to declare
 * only `_id/email/name/role/currentAllocatedExams/submissionHistory/createdAt/
 * lastLogin`, so `profilePic`, `status`, `branch` and `settings` were silently
 * dropped by `UserRepository.upsertByClerkId` (`$setOnInsert: parsed`) and by
 * `UserRepository.update`. Consequences:
 *   - every user was stored without a `status`, so `getCounts()` reported
 *     0 active / 0 inactive / 0 suspended forever;
 *   - notification and preference flags could never be written or read back.
 * Any field the application persists has to appear in `USER_DOCUMENT_FIELDS`,
 * otherwise it is a silently discarded write.
 */

export const USER_ROLES = ['student', 'teacher', 'admin'] as const

export type UserRole = (typeof USER_ROLES)[number]

/** Account lifecycle status. `getCounts()` buckets users by these three values. */
export const USER_STATUSES = ['active', 'inactive', 'suspended'] as const

export type UserStatus = (typeof USER_STATUSES)[number]

export const DEFAULT_USER_ROLE: UserRole = 'student'

export const DEFAULT_USER_STATUS: UserStatus = 'active'

/** Status assumed for a stored record written before the field existed. */
export const IMPLICIT_USER_STATUS: UserStatus = DEFAULT_USER_STATUS

export const DEFAULT_USER_BRANCH = ''

export const DEFAULT_PROFILE_PIC = ''

export interface UserNotificationSettings {
  examReminders: boolean
  gradeUpdates: boolean
  resourceUpdates: boolean
  systemUpdates: boolean
  emailNotifications: boolean
  pushNotifications: boolean
  weeklyDigest: boolean
}

export interface UserPreferences {
  theme: string
  language: string
  timezone: string
  dateFormat: string
  defaultView: string
}

export interface UserPrivacySettings {
  dataUsageAnalytics: boolean
  marketingCommunications: boolean
  loginAlerts: boolean
}

export interface UserSettings {
  notifications: UserNotificationSettings
  preferences: UserPreferences
  privacy: UserPrivacySettings
}

export const DEFAULT_NOTIFICATION_SETTINGS: UserNotificationSettings = {
  examReminders: true,
  gradeUpdates: true,
  resourceUpdates: false,
  systemUpdates: true,
  emailNotifications: true,
  pushNotifications: false,
  weeklyDigest: true,
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  language: 'en',
  timezone: 'UTC-5',
  dateFormat: 'MM/DD/YYYY',
  defaultView: 'dashboard',
}

export const DEFAULT_PRIVACY_SETTINGS: UserPrivacySettings = {
  dataUsageAnalytics: true,
  marketingCommunications: false,
  loginAlerts: true,
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
  preferences: { ...DEFAULT_PREFERENCES },
  privacy: { ...DEFAULT_PRIVACY_SETTINGS },
}

/**
 * Top-level keys of a persisted user document.
 *
 * Kept in sync with `userZodSchema`; `tests/node/admin-users-resources.test.ts`
 * fails if the two drift apart, because a key present in the app but missing
 * from the schema is exactly the silent-strip bug this module documents.
 */
export const USER_DOCUMENT_FIELDS = [
  '_id',
  'email',
  'name',
  'profilePic',
  'role',
  'status',
  'branch',
  'settings',
  'currentAllocatedExams',
  'submissionHistory',
  'createdAt',
  'lastLogin',
] as const

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value)
}

/**
 * Bucket users by status the same way `UserRepository.getCounts()` does.
 *
 * A record with no `status` — written before the field existed, or by any path
 * that bypassed Zod — counts as active, the status it was created with.
 * Treating those records as unclassified is what made the admin dashboard
 * report zeros.
 */
export function countUsersByStatus(
  users: readonly { status?: unknown }[]
): { active: number; inactive: number; suspended: number } {
  const counts = { active: 0, inactive: 0, suspended: 0 }

  for (const user of users) {
    counts[isUserStatus(user.status) ? user.status : IMPLICIT_USER_STATUS] += 1
  }

  return counts
}
