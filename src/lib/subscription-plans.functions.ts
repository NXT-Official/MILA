import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, recordStaffAction } from "@/lib/admin.functions";
import {
  createPlanInputSchema,
  updatePlanInputSchema,
  type SubscriptionPlan,
} from "@/lib/subscription-plans";

function throwPlanError(error: { code?: string; message: string }, fallback: string): never {
  console.error("[subscription-plans]", error);
  if (error.code === "23505") {
    throw new Error(
      error.message.includes("single_featured")
        ? "Another plan is already featured. Unfeature it first."
        : "A plan with this slug already exists.",
    );
  }
  if (error.code === "23514") throw new Error("A field value is invalid.");
  if (error.code === "23503")
    throw new Error("This plan is referenced by other records — archive it instead.");
  throw new Error(fallback);
}

async function getAdminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function unfeatureOtherPlans(db: Awaited<ReturnType<typeof getAdminDb>>, exceptId?: string) {
  let query = db
    .from("subscription_plans")
    .update({ is_featured: false })
    .eq("is_featured", true)
    .is("archived_at", null);
  if (exceptId) query = query.neq("id", exceptId);
  const { error } = await query;
  if (error) throwPlanError(error, "Couldn't update the featured plan.");
}

export const adminListSubscriptionPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubscriptionPlan[]> => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { data, error } = await db
      .from("subscription_plans")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throwPlanError(error, "Couldn't load subscription plans.");
    return (data ?? []) as SubscriptionPlan[];
  });

export const adminCreateSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createPlanInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    if (data.is_featured) await unfeatureOtherPlans(db);
    const { data: created, error } = await db
      .from("subscription_plans")
      .insert(data)
      .select("id")
      .single();
    if (error) throwPlanError(error, "Couldn't create the plan.");
    await recordStaffAction(context.userId, "plan.created", "subscription_plan", created.id, {
      slug: data.slug,
      title: data.title,
      is_active: data.is_active,
      is_featured: data.is_featured,
    });
    return { ok: true };
  });

export const adminUpdateSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => updatePlanInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...fields } = data;
    if (Object.keys(fields).length === 0) return { ok: true };
    const db = await getAdminDb();
    if (fields.is_featured === true) await unfeatureOtherPlans(db, id);
    const { error } = await db.from("subscription_plans").update(fields).eq("id", id);
    if (error) throwPlanError(error, "Couldn't update the plan.");
    await recordStaffAction(context.userId, "plan.updated", "subscription_plan", id, {
      changed_fields: Object.keys(fields),
    });
    return { ok: true };
  });

const SetArchivedInput = z.object({
  id: z.string().uuid(),
  archived: z.boolean(),
});

export const adminSetSubscriptionPlanArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SetArchivedInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { error } = await db
      .from("subscription_plans")
      .update(
        data.archived
          ? { archived_at: new Date().toISOString(), is_active: false, is_featured: false }
          : { archived_at: null },
      )
      .eq("id", data.id);
    if (error) throwPlanError(error, "Couldn't update the plan.");
    await recordStaffAction(
      context.userId,
      data.archived ? "plan.retired" : "plan.restored",
      "subscription_plan",
      data.id,
    );
    return { ok: true };
  });

const DeletePlanInput = z.object({ id: z.string().uuid() });

export const adminDeleteSubscriptionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DeletePlanInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { error } = await db.from("subscription_plans").delete().eq("id", data.id);
    if (error) throwPlanError(error, "Couldn't delete the plan.");
    await recordStaffAction(context.userId, "plan.deleted", "subscription_plan", data.id);
    return { ok: true };
  });

const ReorderPlansInput = z.object({
  plan_ids: z.array(z.string().uuid()).min(1).max(200),
});

export const adminReorderSubscriptionPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ReorderPlansInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const results = await Promise.all(
      data.plan_ids.map((id, index) =>
        db.from("subscription_plans").update({ sort_order: index }).eq("id", id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throwPlanError(failed.error, "Couldn't reorder the plans.");
    return { ok: true };
  });
