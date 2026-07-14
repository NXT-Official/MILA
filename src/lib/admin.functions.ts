import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  APP_ROLES,
  getPermissions,
  hasPermission,
  isAppRole,
  type AppPermission,
  type AppRole,
} from "@/lib/authorization";
import { z } from "zod";

type MilaSupabaseClient = SupabaseClient<Database>;

export async function getCurrentUserRoles(
  supabase: MilaSupabaseClient,
  userId: string,
): Promise<AppRole[]> {
  const [{ data: profile, error: profileError }, { data: roleRows, error: rolesError }] =
    await Promise.all([
      supabase.from("profiles").select("suspended").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
  if (profileError || rolesError) throw new Error("Unable to verify your permissions.");
  if (!profile || profile.suspended) throw new Error("Forbidden: Account suspended");
  return [...new Set((roleRows ?? []).map(({ role }) => role).filter(isAppRole))];
}

export async function assertPermission(
  supabase: MilaSupabaseClient,
  userId: string,
  permission: AppPermission,
): Promise<AppRole[]> {
  const roles = await getCurrentUserRoles(supabase, userId);
  if (!hasPermission(roles, permission)) throw new Error("You do not have permission to do that.");
  return roles;
}

export async function assertAdmin(supabase: MilaSupabaseClient, userId: string) {
  const roles = await getCurrentUserRoles(supabase, userId);
  if (!roles.includes("admin")) throw new Error("You do not have permission to do that.");
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  username: string | null;
  created_at: string;
  is_admin: boolean;
  is_moderator: boolean;
  suspended: boolean;
  ai_credits: number;
}

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: usersRes, error: uErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (uErr) throw new Error(uErr.message);
    const users = usersRes.users;
    const ids = users.map((u) => u.id);

    const [profilesRes, rolesRes, entRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id,full_name,username,suspended").in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id,role").in("user_id", ids),
      supabaseAdmin.from("user_entitlements").select("user_id,ai_credits").in("user_id", ids),
    ]);

    const pMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));
    const adminSet = new Set(
      (rolesRes.data ?? []).filter((r: any) => r.role === "admin").map((r: any) => r.user_id),
    );
    const moderatorSet = new Set(
      (rolesRes.data ?? []).filter((r) => r.role === "moderator").map((r) => r.user_id),
    );
    const credMap = new Map((entRes.data ?? []).map((e: any) => [e.user_id, e.ai_credits]));

    return users.map((u) => {
      const p: any = pMap.get(u.id) ?? {};
      return {
        id: u.id,
        email: u.email ?? null,
        full_name: p.full_name ?? null,
        username: p.username ?? null,
        created_at: u.created_at,
        is_admin: adminSet.has(u.id),
        is_moderator: moderatorSet.has(u.id),
        suspended: !!p.suspended,
        ai_credits: credMap.get(u.id) ?? 0,
      };
    });
  });

const SetRoleInput = z.object({
  user_id: z.string().uuid(),
  role: z.enum(APP_ROLES),
  grant: z.boolean(),
});

export const adminSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SetRoleInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.role === "admin" && data.user_id === context.userId && !data.grant) {
      throw new Error("You cannot revoke your own Steward role.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("manage_user_role", {
      _actor_user_id: context.userId,
      _target_user_id: data.user_id,
      _role: data.role,
      _grant: data.grant,
    });
    if (error) {
      if (error.message.includes("last_active_steward")) {
        throw new Error("Mila must always have at least one active Steward.");
      }
      if (error.message.includes("target_suspended")) {
        throw new Error("Reinstate this member before assigning a staff role.");
      }
      if (error.message.includes("target_not_found")) throw new Error("Member not found.");
      throw new Error("Couldn't update this role.");
    }
    return { ok: true, status: result };
  });

const SetSuspendedInput = z.object({
  user_id: z.string().uuid(),
  suspended: z.boolean(),
});

export const adminSetSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SetSuspendedInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("set_user_suspended", {
      _actor_user_id: context.userId,
      _target_user_id: data.user_id,
      _suspended: data.suspended,
    });
    if (error) {
      if (error.message.includes("last_active_steward")) {
        throw new Error("Mila must always have at least one active Steward.");
      }
      if (error.message.includes("target_not_found")) throw new Error("Member not found.");
      throw new Error("Couldn't update this member's status.");
    }
    return { ok: true };
  });

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_-]+$/, "3-30 letters, numbers, - or _ only.");

const CreateMemberInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().trim().max(100).optional(),
  username: usernameSchema.optional(),
});

export const adminCreateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => CreateMemberInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name ?? "", username: data.username },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateMemberInput = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().trim().max(100).optional(),
  username: usernameSchema.optional().or(z.literal("")),
});

export const adminUpdateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => UpdateMemberInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ full_name: data.full_name ?? null, username: data.username || null })
      .eq("id", data.user_id);
    if (error) {
      throw new Error(
        error.message.includes("duplicate") ? "Username already taken." : error.message,
      );
    }
    return { ok: true };
  });

export interface AdminPostRow {
  id: string;
  user_id: string;
  caption: string | null;
  created_at: string;
  hidden: boolean;
  hidden_reason: string | null;
  image_url_back: string;
  image_url_front: string;
  author_name: string | null;
  author_email: string | null;
}

export const adminListPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminPostRow[]> => {
    const roles = await assertPermission(context.supabase, context.userId, "moderation.view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("posts")
      .select("id,user_id,caption,created_at,hidden,hidden_reason,image_url_back,image_url_front")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Couldn't load the moderation queue.");

    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    const [profilesRes, usersRes] = await Promise.all([
      ids.length
        ? supabaseAdmin.from("profiles").select("id,full_name").in("id", ids)
        : Promise.resolve({ data: [] as any[], error: null }),
      roles.includes("admin")
        ? supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 })
        : Promise.resolve({ data: { users: [] }, error: null }),
    ]);
    if (profilesRes.error || usersRes.error) {
      throw new Error("Couldn't load member context for the moderation queue.");
    }
    const nameMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.full_name]));
    const emailMap = new Map(usersRes.data.users.map((u: any) => [u.id, u.email ?? null]));

    const paths = (rows ?? []).flatMap((r: any) => [r.image_url_back, r.image_url_front]);
    const signed = paths.length
      ? await supabaseAdmin.storage.from("posts").createSignedUrls(paths, 3600)
      : { data: [] as any[], error: null };
    if (signed.error) throw new Error("Couldn't load moderation images.");
    const urlMap = new Map<string, string>();
    (signed.data ?? []).forEach((s: any) => {
      if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl);
    });

    return (rows ?? []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      caption: r.caption,
      created_at: r.created_at,
      hidden: r.hidden,
      hidden_reason: r.hidden_reason,
      image_url_back: urlMap.get(r.image_url_back) ?? "",
      image_url_front: urlMap.get(r.image_url_front) ?? "",
      author_name: nameMap.get(r.user_id) ?? null,
      author_email: emailMap.get(r.user_id) ?? null,
    }));
  });

const HidePostInput = z.object({
  post_id: z.string().uuid(),
  hidden: z.boolean(),
  reason: z.string().max(280).optional().nullable(),
});

export const adminHidePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => HidePostInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertPermission(context.supabase, context.userId, "moderation.manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("posts")
      .update({
        hidden: data.hidden,
        hidden_reason: data.hidden ? (data.reason ?? null) : null,
        hidden_at: data.hidden ? new Date().toISOString() : null,
      })
      .eq("id", data.post_id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error("Couldn't update this post.");
    if (!updated) throw new Error("Post not found.");
    await recordStaffAction(
      context.userId,
      data.hidden ? "post.hidden" : "post.restored",
      "post",
      data.post_id,
      {
        reason: data.hidden ? (data.reason ?? null) : null,
      },
    );
    return { ok: true };
  });

const DeletePostInput = z.object({ post_id: z.string().uuid() });

export const adminDeletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DeletePostInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertPermission(context.supabase, context.userId, "moderation.manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deleted, error } = await supabaseAdmin
      .from("posts")
      .delete()
      .eq("id", data.post_id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error("Couldn't delete this post.");
    if (!deleted) throw new Error("Post not found.");
    await recordStaffAction(context.userId, "post.deleted", "post", data.post_id);
    return { ok: true };
  });

export interface AdminSupportMessageRow {
  id: string;
  kind: "help" | "feedback";
  message: string;
  resolved: boolean;
  created_at: string;
}

export const adminListSupportMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminSupportMessageRow[]> => {
    await assertPermission(context.supabase, context.userId, "support.view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("support_messages")
      .select("id,kind,message,resolved,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Couldn't load support messages.");
    return (data ?? []) as AdminSupportMessageRow[];
  });

const ResolveSupportMessageInput = z.object({
  message_id: z.string().uuid(),
  resolved: z.boolean(),
});

export const adminResolveSupportMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ResolveSupportMessageInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertPermission(context.supabase, context.userId, "support.manage");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin
      .from("support_messages")
      .update({ resolved: data.resolved })
      .eq("id", data.message_id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error("Couldn't update this support message.");
    if (!updated) throw new Error("Support message not found.");
    await recordStaffAction(
      context.userId,
      data.resolved ? "support.resolved" : "support.reopened",
      "support_message",
      data.message_id,
    );
    return { ok: true };
  });

export interface AdminDashboardStats {
  totalMembers: number;
  totalStewards: number;
  aiCreditsAvailable: number;
  totalPosts: number;
  hiddenPosts: number;
  openSupportMessages: number;
  recentMembers: {
    id: string;
    full_name: string | null;
    username: string | null;
    created_at: string;
  }[];
  recentPosts: {
    id: string;
    author_name: string | null;
    caption: string | null;
    hidden: boolean;
    created_at: string;
  }[];
}

export const adminDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminDashboardStats> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      membersCount,
      stewardsCount,
      entitlements,
      postsCount,
      hiddenPostsCount,
      openSupportCount,
      recentMembersRes,
      recentPostsRes,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "admin"),
      supabaseAdmin.from("user_entitlements").select("ai_credits"),
      supabaseAdmin.from("posts").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("posts").select("*", { count: "exact", head: true }).eq("hidden", true),
      supabaseAdmin
        .from("support_messages")
        .select("*", { count: "exact", head: true })
        .eq("resolved", false),
      supabaseAdmin
        .from("profiles")
        .select("id,full_name,username,created_at")
        .order("created_at", { ascending: false })
        .limit(5),
      supabaseAdmin
        .from("posts")
        .select("id,user_id,caption,hidden,created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    // TODO: no credits ledger table exists yet — this is the current running
    // balance across all members, not a historical "issued" total.
    const aiCreditsAvailable = (entitlements.data ?? []).reduce(
      (sum: number, e: any) => sum + (e.ai_credits ?? 0),
      0,
    );

    const recentPostUserIds = Array.from(
      new Set((recentPostsRes.data ?? []).map((p: any) => p.user_id)),
    );
    const authorNames = recentPostUserIds.length
      ? await supabaseAdmin.from("profiles").select("id,full_name").in("id", recentPostUserIds)
      : { data: [] as any[] };
    const nameMap = new Map((authorNames.data ?? []).map((p: any) => [p.id, p.full_name]));

    return {
      totalMembers: membersCount.count ?? 0,
      totalStewards: stewardsCount.count ?? 0,
      aiCreditsAvailable,
      totalPosts: postsCount.count ?? 0,
      hiddenPosts: hiddenPostsCount.count ?? 0,
      openSupportMessages: openSupportCount.count ?? 0,
      recentMembers: (recentMembersRes.data ?? []) as AdminDashboardStats["recentMembers"],
      recentPosts: (recentPostsRes.data ?? []).map((p: any) => ({
        id: p.id,
        author_name: nameMap.get(p.user_id) ?? null,
        caption: p.caption,
        hidden: p.hidden,
        created_at: p.created_at,
      })),
    };
  });

export async function recordStaffAction(
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Json = {},
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("staff_audit_log").insert({
    actor_user_id: actorUserId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
  });
  if (error) throw new Error("The action succeeded, but its audit record could not be saved.");
}

export const getStaffAuthorization = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const roles = await getCurrentUserRoles(context.supabase, context.userId);
      const permissions = getPermissions(roles);
      return {
        roles,
        permissions,
        is_admin: roles.includes("admin"),
        is_moderator: roles.includes("moderator"),
        can_access_staff_area: permissions.includes("admin.access"),
      };
    } catch {
      return {
        roles: [] as AppRole[],
        permissions: [] as AppPermission[],
        is_admin: false,
        is_moderator: false,
        can_access_staff_area: false,
      };
    }
  });
