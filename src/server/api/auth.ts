import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./respond";

/**
 * Who is calling an `/api/v1` route.
 *
 * The **only** accepted proof of identity is a Supabase access token in the
 * Authorization header. A `userId` in the request body is not authentication —
 * it is a client-supplied string, and trusting one would let any caller act as
 * any member.
 *
 * Two clients come back:
 *
 * - `user` — the verified identity. Derived from the token, never from the body.
 * - `supabase` — a client that carries the caller's own token, so **RLS applies
 *   exactly as it does in the browser**. Routes do their ordinary reads and
 *   writes through this one.
 *
 * A route reaches for `supabaseAdmin` only where the audit says it must (a
 * privileged read, an admin action), and never as a shortcut around a policy.
 */
export type AuthedRequest = {
  user: { id: string; email: string | null };
  supabase: SupabaseClient<Database>;
  token: string;
};

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export async function requireAuthenticatedUser(request: Request): Promise<AuthedRequest> {
  const token = bearerToken(request);
  if (!token) {
    throw new ApiError("UNAUTHENTICATED", "Sign in to continue.", 401);
  }

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = requireEnv({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });

  // Built with the PUBLISHABLE key plus the caller's bearer token, never the
  // service-role key: this client must be exactly as privileged as the member.
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Verified against Supabase rather than decoded locally — a JWT's payload is
  // readable by anyone, and only the auth server can say the signature is good
  // and the session has not been revoked.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new ApiError("UNAUTHENTICATED", "Your session has expired. Sign in again.", 401);
  }

  return {
    user: { id: data.user.id, email: data.user.email ?? null },
    supabase,
    token,
  };
}

/**
 * Suspension is checked here rather than in each route: it is the one gate that
 * must hold on every authenticated surface, and a route that forgets it is a
 * suspended member who can still spend credits.
 */
export async function requireActiveMember(request: Request): Promise<AuthedRequest> {
  const authed = await requireAuthenticatedUser(request);

  const { data } = await authed.supabase
    .from("profiles")
    .select("suspended")
    .eq("id", authed.user.id)
    .maybeSingle();

  if (data?.suspended) {
    throw new ApiError("ACCOUNT_SUSPENDED", "This account is suspended.", 403);
  }

  return authed;
}
