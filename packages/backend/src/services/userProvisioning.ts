/**
 * User provisioning - single source of truth for creating a local user record
 * from a Clerk identity.
 *
 * Two API routes used to provision independently:
 *   - `POST /api/users/create`  -> `userRepo.upsertByClerkId` with the client's role
 *   - `POST /api/exams/create`  -> `getUserModel().findById()` then `create()` with 'teacher'
 *
 * Because `upsertByClerkId` used `$setOnInsert` for every field, whichever route
 * ran first fixed the stored role for the lifetime of the account, and the
 * find-then-create pair in `exams/create` raced with the dashboard's upsert.
 * Both now go through `buildUserProfile` + the atomic `upsertByClerkId`.
 */

export const USER_ROLES = ['student', 'teacher', 'admin'] as const

export type UserRole = (typeof USER_ROLES)[number]

/**
 * Role for a brand new account. A client cannot ask for `teacher` or `admin`:
 * promotion is an administrative action, never a self-service one.
 */
export const SELF_SERVICE_ROLE: UserRole = 'student'

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

/**
 * Resolve the role to store. An existing role always wins so that loading the
 * dashboard never resets a role an admin assigned; otherwise the caller falls
 * back to the self-service default. `requestedRole` is intentionally ignored.
 */
export function resolveProvisionedRole(
  existingRole?: unknown,
  _requestedRole?: unknown,
): UserRole {
  if (isUserRole(existingRole)) return existingRole
  return SELF_SERVICE_ROLE
}

export interface ClerkIdentity {
  /** Clerk user id - used verbatim as the Mongo `_id`. */
  userId: string
  email: string
  name?: string
  /** Profile picture URL. Not part of the user schema, kept for callers. */
  imageUrl?: string
}

export interface UserProfileInsert {
  _id: string
  email: string
  name?: string
  role: UserRole
  currentAllocatedExams: string[]
  submissionHistory: string[]
  createdAt: Date
  lastLogin: Date
}

/**
 * Build the document for a first-time insert. Every field here is either
 * Clerk-owned or a default, so it is safe to apply with `$setOnInsert`.
 */
export function buildUserProfile(
  identity: ClerkIdentity,
  options: { existingRole?: unknown; now?: Date } = {},
): UserProfileInsert {
  return {
    _id: identity.userId,
    email: identity.email,
    name: identity.name ?? '',
    role: resolveProvisionedRole(options.existingRole),
    currentAllocatedExams: [],
    submissionHistory: [],
    createdAt: options.now ?? new Date(),
    lastLogin: options.now ?? new Date(),
  }
}

/** Fields a returning visitor refreshes on every sign-in. */
export interface ClerkOwnedUpdate {
  email?: string
  name?: string
  lastLogin?: Date
}

const CLERK_OWNED_KEYS = ['email', 'name', 'lastLogin'] as const
const INSERT_ONLY_KEYS = ['role', 'currentAllocatedExams', 'submissionHistory', 'createdAt'] as const

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

/**
 * Split a validated user document into the two halves of the upsert.
 *
 * `_id` is excluded from both: the upsert filter already pins it and Mongo
 * rejects updates to that path.
 */
export function splitUpsertFields(document: Record<string, unknown>): {
  $set: ClerkOwnedUpdate
  $setOnInsert: Record<string, unknown>
} {
  return {
    $set: pick(document, CLERK_OWNED_KEYS) as ClerkOwnedUpdate,
    $setOnInsert: pick(document, INSERT_ONLY_KEYS),
  }
}