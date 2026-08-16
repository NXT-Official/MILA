import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DeleteAccountDeps } from "./account.functions";
import { cancelViaPaddleApi } from "./subscriptions.functions";

/** Shared with `/api/v1/account/delete`, so both clients delete an account the same way. */
export const supabaseDeleteAccountDeps: DeleteAccountDeps = {
  getEmail: async (userId) => {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error) throw error;
    return data.user?.email ?? null;
  },

  cancelSubscription: async (paddleSubscriptionId) => {
    const result = await cancelViaPaddleApi(paddleSubscriptionId, "immediately");
    return !("error" in result);
  },

  purgeStorage: async (userId) => {
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
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("[deleteMyAccount] auth delete failed", error);
      return false;
    }
    return true;
  },
};
