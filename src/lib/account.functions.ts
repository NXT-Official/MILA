import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { IN_FORCE_SUBSCRIPTION_STATUSES } from "@/constants/subscriptions";
import { cancelViaPaddleApi } from "./subscriptions.functions";

type MilaSupabaseClient = SupabaseClient<Database>;

export const DeleteAccountInput = z.object({ email: z.string().min(1).max(320) });

/**
 * The one failure here that is the member's to fix. Exported so
 * `/api/v1/account/delete` can answer it as `VALIDATION_FAILED` — the phone
 * shows that inline under the field, where the other two failures (billing,
 * auth) belong in a retry state instead.
 */
export const EMAIL_MISMATCH = "That email doesn't match the account you're signed in to.";

export type DeleteAccountResult = { success: true } | { error: string };

export type DeleteAccountDeps = {
  getEmail: (userId: string) => Promise<string | null>;
  cancelSubscription: (paddleSubscriptionId: string) => Promise<boolean>;
  purgeStorage: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<boolean>;
};

export async function deleteAccountForUser(
  db: MilaSupabaseClient,
  userId: string,
  typedEmail: string,
  deps: DeleteAccountDeps,
): Promise<DeleteAccountResult> {
  const email = await deps.getEmail(userId);
  if (!email || typedEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return { error: EMAIL_MISMATCH };
  }

  const { data: subscription } = await db
    .from("subscriptions")
    .select("paddle_subscription_id")
    .eq("user_id", userId)
    .in("status", IN_FORCE_SUBSCRIPTION_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscription) {
    const canceled = await deps.cancelSubscription(subscription.paddle_subscription_id);
    if (!canceled) {
      return {
        error: "We couldn't stop your billing just now, so nothing was deleted. Please try again.",
      };
    }
  }

  await deps.purgeStorage(userId);

  if (!(await deps.deleteUser(userId))) {
    return { error: "We couldn't delete your account just now. Please try again." };
  }
  return { success: true };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Shared with `/api/v1/account/delete`, so both clients delete an account the same way. */
export const supabaseDeleteAccountDeps: DeleteAccountDeps = {
  getEmail: async (userId) => {
    const { data, error } = await (await admin()).auth.admin.getUserById(userId);
    if (error) throw error;
    return data.user?.email ?? null;
  },

  cancelSubscription: async (paddleSubscriptionId) => {
    const result = await cancelViaPaddleApi(paddleSubscriptionId, "immediately");
    return !("error" in result);
  },

  purgeStorage: async (userId) => {
    const supabaseAdmin = await admin();
    for (const bucket of ["outfits", "posts"] as const) {
      const { data: files, error } = await supabaseAdmin.storage
        .from(bucket)
        .list(userId, { limit: 1000 });
      if (error) {
        console.error(`[deleteMyAccount] couldn't list ${bucket}`, error);
        continue;
      }
      if (!files?.length) continue;
      const { error: removeError } = await supabaseAdmin.storage
        .from(bucket)
        .remove(files.map((f) => `${userId}/${f.name}`));
      if (removeError) console.error(`[deleteMyAccount] couldn't purge ${bucket}`, removeError);
    }
  },

  deleteUser: async (userId) => {
    const { error } = await (await admin()).auth.admin.deleteUser(userId);
    if (error) {
      console.error("[deleteMyAccount] auth delete failed", error);
      return false;
    }
    return true;
  },
};

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => DeleteAccountInput.parse(input))
  .handler(async ({ data, context }): Promise<DeleteAccountResult> => {
    return deleteAccountForUser(
      context.supabase,
      context.userId,
      data.email,
      supabaseDeleteAccountDeps,
    );
  });
