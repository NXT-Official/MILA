export const APP_ROLES = ["admin", "moderator"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const APP_PERMISSIONS = [
  "admin.access",
  "admin.dashboard.view",
  "members.view",
  "members.manage",
  "members.suspend",
  "roles.manage",
  "moderation.view",
  "moderation.manage",
  "support.view",
  "support.manage",
  "subscriptionPlans.manage",
] as const;
export type AppPermission = (typeof APP_PERMISSIONS)[number];

export const ROLE_PERMISSIONS = {
  admin: APP_PERMISSIONS,
  moderator: [
    "admin.access",
    "moderation.view",
    "moderation.manage",
    "support.view",
    "support.manage",
  ],
} as const satisfies Record<AppRole, readonly AppPermission[]>;

export const STAFF_ROUTE_PERMISSIONS = {
  "/admin": "admin.dashboard.view",
  "/admin/members": "members.view",
  "/admin/subscription-plans": "subscriptionPlans.manage",
  "/admin/moderation": "moderation.view",
  "/admin/support": "support.view",
} as const satisfies Record<string, AppPermission>;

export function isAppRole(role: string): role is AppRole {
  return APP_ROLES.includes(role as AppRole);
}

export function getPermissions(roles: readonly AppRole[]): AppPermission[] {
  return [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]))];
}

export function hasPermission(roles: readonly AppRole[], permission: AppPermission): boolean {
  return roles.some((role) =>
    (ROLE_PERMISSIONS[role] as readonly AppPermission[]).includes(permission),
  );
}
