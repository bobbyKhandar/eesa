/**
 * Role predicates for admin-only surfaces.
 *
 * Dependency-free on purpose: this module is imported by both the server
 * layout guard and the client sidebar, and by the unit tests.
 */

export const ADMIN_ROLE = "admin";

export interface NavigationItem {
  name: string;
  href: string;
  /** Hidden from anyone who is not an admin. */
  adminOnly?: boolean;
}

export interface NavigationSection {
  title: string;
  items: NavigationItem[];
}

/**
 * `true` only for the literal admin role.
 *
 * The sidebar used to render the Admin section for every signed-in visitor, and
 * `/admin/**` had no guard at all, so any user could read the admin pages and
 * the database tools behind them.
 */
export function isAdminRole(role: unknown): boolean {
  return typeof role === "string" && role.trim().toLowerCase() === ADMIN_ROLE;
}

/**
 * Drop admin-only items for non-admins and remove sections left empty.
 *
 * A user record that has not been provisioned yet, or a lookup that failed,
 * resolves to `isAdmin === false`, which fails closed: the links disappear
 * rather than being offered to everyone.
 *
 * Generic over the item type so callers keep their own extras (e.g. the icon on
 * the sidebar's nav items).
 */
export function filterNavigation<T extends NavigationItem>(
  sections: readonly { title: string; items: T[] }[],
  isAdmin: boolean
): { title: string; items: T[] }[] {
  if (isAdmin) {
    return sections.map((section) => ({ ...section, items: [...section.items] }));
  }

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.adminOnly),
    }))
    .filter((section) => section.items.length > 0);
}

/** Route prefixes that require the admin role. Mirrors `app/admin/**`. */
export const ADMIN_ROUTE_PREFIXES = ["/admin"] as const;

export function isAdminPath(pathname: string): boolean {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return ADMIN_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
