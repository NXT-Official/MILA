import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, recordStaffAction } from "@/lib/admin.functions";
import {
  createCreditPackInputSchema,
  updateCreditPackInputSchema,
  type CreditPack,
} from "@/lib/credit-packs";

function throwPackError(error: { code?: string; message: string }, fallback: string): never {
  console.error("[credit-packs]", error);
  if (error.code === "23505") throw new Error("A credit pack with this slug already exists.");
  if (error.code === "23514") throw new Error("A field value is invalid.");
  if (error.code === "23503")
    throw new Error("This pack is referenced by past purchases — archive it instead.");
  throw new Error(fallback);
}

async function getAdminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const adminListCreditPacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CreditPack[]> => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { data, error } = await db
      .from("credit_packs")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throwPackError(error, "Couldn't load credit packs.");
    return (data ?? []) as CreditPack[];
  });

export const adminCreateCreditPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => createCreditPackInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { data: created, error } = await db
      .from("credit_packs")
      .insert(data)
      .select("id")
      .single();
    if (error) throwPackError(error, "Couldn't create the pack.");
    await recordStaffAction(context.userId, "credit_pack.created", "credit_pack", created.id, {
      slug: data.slug,
      title: data.title,
      is_active: data.is_active,
    });
    return { ok: true };
  });

export const adminUpdateCreditPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => updateCreditPackInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { id, ...fields } = data;
    if (Object.keys(fields).length === 0) return { ok: true };
    const db = await getAdminDb();
    const { error } = await db.from("credit_packs").update(fields).eq("id", id);
    if (error) throwPackError(error, "Couldn't update the pack.");
    await recordStaffAction(context.userId, "credit_pack.updated", "credit_pack", id, {
      changed_fields: Object.keys(fields),
    });
    return { ok: true };
  });

const SetArchivedInput = z.object({
  id: z.string().uuid(),
  archived: z.boolean(),
});

export const adminSetCreditPackArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SetArchivedInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { error } = await db
      .from("credit_packs")
      .update(
        data.archived
          ? { archived_at: new Date().toISOString(), is_active: false }
          : { archived_at: null },
      )
      .eq("id", data.id);
    if (error) throwPackError(error, "Couldn't update the pack.");
    await recordStaffAction(
      context.userId,
      data.archived ? "credit_pack.retired" : "credit_pack.restored",
      "credit_pack",
      data.id,
    );
    return { ok: true };
  });

const DeletePackInput = z.object({ id: z.string().uuid() });

export const adminDeleteCreditPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DeletePackInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const db = await getAdminDb();
    const { error } = await db.from("credit_packs").delete().eq("id", data.id);
    if (error) throwPackError(error, "Couldn't delete the pack.");
    await recordStaffAction(context.userId, "credit_pack.deleted", "credit_pack", data.id);
    return { ok: true };
  });
