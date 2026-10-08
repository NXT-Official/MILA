import type { SupabaseClient } from "@supabase/supabase-js";
import { authCallbackUrl } from "@/lib/safe-redirect";

/**
 * Google sign-in that comes back to the deployment she started on (preview or
 * live) and to the page she was on, instead of always `/dashboard`.
 */
export async function startGoogleSignIn(
  auth: Pick<SupabaseClient["auth"], "signInWithOAuth">,
  origin: string,
  returnTo: unknown,
): Promise<{ error: unknown }> {
  const { error } = await auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authCallbackUrl(origin, returnTo) },
  });
  return { error };
}
