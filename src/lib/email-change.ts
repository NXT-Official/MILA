import type { SupabaseClient } from "@supabase/supabase-js";
import { authCallbackUrl } from "@/lib/safe-redirect";

/**
 * Ask Supabase to change her email. The confirmation link must return her to
 * the deployment she is on (preview or live) and to Account: without
 * `emailRedirectTo` Supabase falls back to the project's Site URL, the live
 * site. `updateUser(attributes, { emailRedirectTo })`.
 * // src: node_modules/@supabase/auth-js/src/GoTrueClient.ts:3297 · 2.110.0
 * // src: https://supabase.com/docs/guides/auth/redirect-urls
 */
export async function requestEmailChange(
  auth: Pick<SupabaseClient["auth"], "updateUser">,
  newEmail: string,
  origin: string,
): Promise<{ error: unknown }> {
  const { error } = await auth.updateUser(
    { email: newEmail.trim() },
    { emailRedirectTo: authCallbackUrl(origin, "/account") },
  );
  return { error };
}
