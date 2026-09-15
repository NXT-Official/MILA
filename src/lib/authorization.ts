import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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

export function isAppRole(role: string): role is AppRole {
  return APP_ROLES.includes(role as AppRole);
}

export function hasPermission(roles: readonly AppRole[], permission: AppPermission): boolean {
  return roles.some((role) =>
    (ROLE_PERMISSIONS[role] as readonly AppPermission[]).includes(permission),
  );
}

/**
 * Staff (admin/moderator) role management now lives entirely in the separate
 * MILA_ADMIN app. This lookup stays here because the member app itself still
 * needs it: a moderator viewing another member's profile through the regular
 * site can see posts that have been hidden from the public feed.
 */
export async function getCurrentUserRoles(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<AppRole[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error("Unable to verify your permissions.");
  return [...new Set((data ?? []).map(({ role }) => role).filter(isAppRole))];
}
