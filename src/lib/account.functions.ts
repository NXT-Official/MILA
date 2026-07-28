import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { IN_FORCE_SUBSCRIPTION_STATUSES } from "@/constants/subscriptions";
import { cancelViaPaddleApi } from "./subscriptions.functions";

type MilaSupabaseClient = SupabaseClient<Database>;

/** Every user upload lives under a `<userId>/` prefix in one of these. */
const USER_BUCKETS = ["outfits", "posts"] as const;

export type DeleteAccountResult = { success: true } | { error: string };

export type DeleteAccountDeps = {
  getEmail: (userId: string) => Promise<string | null>;
  cancelSubscription: (paddleSubscriptionId: string) => Promise<boolean>;
  purgeStorage: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<boolean>;
};

/**
 * Order matters: billing dies first. If Paddle refuses, the account survives —
 * the alternative is a deleted user whose card keeps getting charged with no
 * way left to log in and stop it. Storage next (nothing cascades to buckets),
 * then the auth user, which every table hangs off via ON DELETE CASCADE.
 */
export async function deleteAccountForUser(
  db: MilaSupabaseClient,
  userId: string,
  typedEmail: string,
  deps: DeleteAccountDeps,
): Promise<DeleteAccountResult> {
  const email = await deps.getEmail(userId);
  // Re-checked server-side: the client's matching input is a UX affordance, not
  // the gate. Case and whitespace are the user's typing, not their intent.
  if (!email || typedEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return { error: "That email doesn't match the account you're signed in to." };
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

const supabaseDeleteAccountDeps: DeleteAccountDeps = {
  getEmail: async (userId) => {
    const { data, error } = await (await admin()).auth.admin.getUserById(userId);
    if (error) throw error;
    return data.user?.email ?? null;
  },

  cancelSubscription: async (paddleSubscriptionId) => {
    // Immediately, not next_billing_period: there'll be no account left to
    // serve the rest of the period to. Paddle prorates the refund.
    const result = await cancelViaPaddleApi(paddleSubscriptionId, "immediately");
    return !("error" in result);
  },

  purgeStorage: async (userId) => {
    const supabaseAdmin = await admin();
    for (const bucket of USER_BUCKETS) {
      // ponytail: one page of 1000 per bucket, uploads are flat under the
      // user's folder. Loop on `next` if anyone ever stores more than that.
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
      // Orphaned images are worth logging, not worth aborting a deletion over.
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
  .validator((input: unknown) => z.object({ email: z.string().min(1).max(320) }).parse(input))
  .handler(async ({ data, context }): Promise<DeleteAccountResult> => {
    return deleteAccountForUser(
      context.supabase,
      context.userId,
      data.email,
      supabaseDeleteAccountDeps,
    );
  });
