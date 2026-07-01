import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  username: string | null;
  created_at: string;
  is_admin: boolean;
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
        suspended: !!p.suspended,
        ai_credits: credMap.get(u.id) ?? 0,
      };
    });
  });

const SetRoleInput = z.object({
  user_id: z.string().uuid(),
  grant: z.boolean(),
});

export const adminSetAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetRoleInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId && !data.grant) {
      throw new Error("You cannot revoke your own admin role.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.user_id, role: "admin" });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const SetSuspendedInput = z.object({
  user_id: z.string().uuid(),
  suspended: z.boolean(),
});

export const adminSetSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SetSuspendedInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ suspended: data.suspended })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
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
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("posts")
      .select("id,user_id,caption,created_at,hidden,hidden_reason,image_url_back,image_url_front")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    const [profilesRes, usersRes] = await Promise.all([
      ids.length
        ? supabaseAdmin.from("profiles").select("id,full_name").in("id", ids)
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ]);
    const nameMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.full_name]));
    const emailMap = new Map(usersRes.data.users.map((u: any) => [u.id, u.email ?? null]));

    const paths = (rows ?? []).flatMap((r: any) => [r.image_url_back, r.image_url_front]);
    const signed = paths.length
      ? await supabaseAdmin.storage.from("posts").createSignedUrls(paths, 3600)
      : { data: [] as any[], error: null };
    if (signed.error) throw new Error(signed.error.message);
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
  .inputValidator((input: unknown) => HidePostInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("posts")
      .update({
        hidden: data.hidden,
        hidden_reason: data.hidden ? (data.reason ?? null) : null,
        hidden_at: data.hidden ? new Date().toISOString() : null,
      })
      .eq("id", data.post_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const DeletePostInput = z.object({ post_id: z.string().uuid() });

export const adminDeletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeletePostInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("posts").delete().eq("id", data.post_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminAmIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) return { is_admin: false };
    return { is_admin: !!data };
  });