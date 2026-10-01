export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  branch: string;
}

export interface AdminUserCounts {
  total: number;
  active: number;
  inactive: number;
  suspended: number;
  admins: number;
}

const STATUSES = ["active", "inactive", "suspended"] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function toAdminUserRow(user: unknown): AdminUserRow | null {
  if (!user || typeof user !== "object") return null;
  const record = user as Record<string, unknown>;
  const id = record._id == null ? "" : String(record._id);
  const email = text(record.email);
  if (!id || !email) return null;

  const status = text(record.status);
  return {
    id,
    name: text(record.name) || email,
    email,
    role: text(record.role) || "student",
    status: (STATUSES as readonly string[]).includes(status) ? status : "active",
    branch: text(record.branch),
  };
}

export function filterAdminUsers(
  users: AdminUserRow[],
  filters: { search?: string; role?: string; status?: string },
): AdminUserRow[] {
  const search = (filters.search ?? "").trim().toLowerCase();
  const role = filters.role && filters.role !== "all" ? filters.role : "";
  const status = filters.status && filters.status !== "all" ? filters.status : "";

  return users.filter((user) => {
    if (role && user.role !== role) return false;
    if (status && user.status !== status) return false;
    if (!search) return true;
    return user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search);
  });
}

export function isAccountStatus(value: unknown): value is (typeof STATUSES)[number] {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}
