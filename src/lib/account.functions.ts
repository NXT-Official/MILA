import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  IN_FORCE_SUBSCRIPTION_STATUSES,
  isStaffGrantedSubscription,
} from "@/constants/subscriptions";
import { cancelViaPaddleApi } from "./subscriptions.functions";

type MilaSupabaseClient = SupabaseClient<Database>;

export type DeleteAccountResult = { success: true } | { error: string };

export type DeleteAccountDeps = {
  getEmail: (userId: string) => Promise<string | null>;
  /** Read before the delete: `profiles` cascades away with the account. */
  getProfileName: (userId: string) => Promise<string | null>;
  cancelSubscription: (paddleSubscriptionId: string) => Promise<boolean>;
  purgeStorage: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<boolean>;
  notifyAccountDeleted: (input: { email: string; name: string | null }) => Promise<unknown>;
};

/**
 * Never throws: whatever goes wrong comes back as a `{ error }` the member can
 * read, never as the raw message of a missing key or a failed query.
 */
export async function deleteAccountForUser(
  db: MilaSupabaseClient,
  userId: string,
  typedEmail: string,
  deps: DeleteAccountDeps,
): Promise<DeleteAccountResult> {
  try {
    return await deleteAccount(db, userId, typedEmail, deps);
  } catch (cause) {
    console.error("[deleteMyAccount] delete failed", cause);
    return { error: "We couldn't delete your account just now. Please try again." };
  }
}

async function deleteAccount(
  db: MilaSupabaseClient,
  userId: string,
  typedEmail: string,
  deps: DeleteAccountDeps,
): Promise<DeleteAccountResult> {
  const email = await deps.getEmail(userId);
  if (!email || typedEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
    return { error: "That email doesn't match the account you're signed in to." };
  }
  const name = await deps.getProfileName(userId).catch(() => null);

  const { data: subscription, error: lookupError } = await db
    .from("subscriptions")
    .select("paddle_subscription_id")
    .eq("user_id", userId)
    .in("status", IN_FORCE_SUBSCRIPTION_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // An unreadable membership is not "no membership": deleting on that guess
  // could leave a paid plan billing against an account that no longer exists.
  if (lookupError) throw lookupError;

  // A plan staff granted has no Paddle subscription behind it; nothing to stop.
  if (subscription && !isStaffGrantedSubscription(subscription.paddle_subscription_id)) {
    const canceled = await deps
      .cancelSubscription(subscription.paddle_subscription_id)
      .catch((cause) => {
        console.error("[deleteMyAccount] billing cancel threw", cause);
        return false;
      });
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

  // The account is gone; the member still gets a record of it. Best effort —
  // the deletion has happened and must not be reported as failed over mail.
  await deps
    .notifyAccountDeleted({ email, name })
    .catch((cause) => console.error("[deleteMyAccount] deletion notice failed", cause));

  return { success: true };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const supabaseDeleteAccountDeps: DeleteAccountDeps = {
  getEmail: async (userId) => {
    const { data, error } = await (await admin()).auth.admin.getUserById(userId);
    if (error) throw error;
    return data.user?.email ?? null;
  },

  getProfileName: async (userId) => {
    const { data } = await (
      await admin()
    )
      .from("profiles")
      .select("full_name,username")
      .eq("id", userId)
      .maybeSingle();
    return data?.full_name ?? data?.username ?? null;
  },

  cancelSubscription: async (paddleSubscriptionId) => {
    const result = await cancelViaPaddleApi(paddleSubscriptionId, "immediately");
    return !("error" in result);
  },

  purgeStorage: async (userId) => {
    const supabaseAdmin = await admin();
    for (const bucket of ["outfits", "posts", "profile-photos"] as const) {
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

  notifyAccountDeleted: async ({ email, name }) => {
    const { sendAccountDeletedEmail } = await import("./account-emails.server");
    return sendAccountDeletedEmail({ email, name });
  },
};

/**
 * Sent after a password change made while signed in (the reset-link flow
 * notifies inside `updatePassword`). Best effort: the password is already
 * changed by the time this runs.
 */
export const notifyPasswordChanged = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ sent: boolean; error?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPasswordChangedEmail } = await import("./account-emails.server");
    return sendPasswordChangedEmail(context.userId, { db: supabaseAdmin });
  });

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
